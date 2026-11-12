use crate::{DocSnapshot, PluginPermissions};
use base64::Engine;
use extism::{host_fn, Error, UserData};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::io::{Read, Seek, SeekFrom};
use std::path::PathBuf;
use std::sync::{Arc, Mutex as StdMutex, RwLock};
use std::time::Duration;

/// Hard limits applied to every plugin instance (L1).
pub const CALL_FUEL: u64 = 2_000_000_000;
pub const INIT_FUEL: u64 = 8_000_000_000;
pub const CALL_TIMEOUT: Duration = Duration::from_secs(10);
pub const MAX_MEMORY_PAGES: u32 = 1024;
pub const MAX_WASM_BYTES: usize = 16 * 1024 * 1024;
pub const MAX_INPUT_BYTES: usize = 1024 * 1024;
pub const MAX_OUTPUT_BYTES: usize = 4 * 1024 * 1024;

/// L2 capability limits.
pub const MAX_STORAGE_BYTES: usize = 1024 * 1024;
pub const MAX_STORAGE_VALUE_BYTES: usize = 64 * 1024;
pub const MAX_DOC_BLOCKS: usize = 20_000;
pub const MAX_DOC_TEXT_BYTES: usize = 8 * 1024 * 1024;
const MAX_DOC_PAGE_BLOCKS: usize = 200;
const MAX_DOC_PAGE_BYTES: usize = 512 * 1024;
/// Largest chunk one `sr_file_read` call may return. Parsers stream the file
/// in chunks instead of receiving a whole base64 copy.
pub const MAX_PARSER_CHUNK_BYTES: usize = 1024 * 1024;

/// The file a parser plugin is currently allowed to read. `sr_file_read` is
/// scoped to this job, so plugins never receive a path or general filesystem
/// access.
#[derive(Clone)]
pub struct ParseJob {
    pub path: PathBuf,
    pub size: u64,
}

pub type ParseScope = Arc<StdMutex<Option<ParseJob>>>;

pub fn empty_parse_scope() -> ParseScope {
    Arc::new(StdMutex::new(None))
}

/// Shared, read-only view of the document the user currently has open.
/// Plugins may only see it when the manifest declares `permissions.docRead`.
pub type DocContext = Arc<RwLock<Option<DocSnapshot>>>;

pub fn empty_doc_context() -> DocContext {
    Arc::new(RwLock::new(None))
}

pub struct PluginRuntime {
    pub name: String,
    pub dir: PathBuf,
    pub permissions: PluginPermissions,
    pub docs: DocContext,
    pub parse: ParseScope,
}

impl PluginRuntime {
    fn storage_path(&self) -> PathBuf {
        self.dir.join("storage.json")
    }

    fn require(&self, allowed: bool, capability: &str) -> anyhow::Result<()> {
        if allowed {
            Ok(())
        } else {
            anyhow::bail!("plugin '{}' did not request the {capability} permission", self.name)
        }
    }

    fn load_storage(&self) -> anyhow::Result<BTreeMap<String, String>> {
        match std::fs::read_to_string(self.storage_path()) {
            Ok(text) => Ok(serde_json::from_str(&text).unwrap_or_default()),
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(BTreeMap::new()),
            Err(err) => Err(err.into()),
        }
    }

    fn save_storage(&self, map: &BTreeMap<String, String>) -> anyhow::Result<()> {
        let encoded = serde_json::to_vec(map)?;
        anyhow::ensure!(encoded.len() <= MAX_STORAGE_BYTES, "plugin storage quota exceeded");
        std::fs::create_dir_all(&self.dir)?;
        let tmp = self.dir.join("storage.json.tmp");
        std::fs::write(&tmp, encoded)?;
        std::fs::rename(&tmp, self.storage_path())?;
        Ok(())
    }
}

fn valid_key(key: &str) -> bool {
    !key.is_empty() && key.len() <= 128 && !key.chars().any(|c| c.is_control())
}

pub fn storage_get(runtime: &PluginRuntime, key: &str) -> anyhow::Result<String> {
    runtime.require(runtime.permissions.storage, "storage")?;
    anyhow::ensure!(valid_key(key), "invalid storage key");
    Ok(runtime.load_storage()?.get(key).cloned().unwrap_or_default())
}

pub fn storage_set(runtime: &PluginRuntime, key: &str, value: &str) -> anyhow::Result<()> {
    runtime.require(runtime.permissions.storage, "storage")?;
    anyhow::ensure!(valid_key(key), "invalid storage key");
    anyhow::ensure!(value.len() <= MAX_STORAGE_VALUE_BYTES, "storage value too large");
    let mut map = runtime.load_storage()?;
    map.insert(key.to_string(), value.to_string());
    runtime.save_storage(&map)
}

pub fn storage_delete(runtime: &PluginRuntime, key: &str) -> anyhow::Result<()> {
    runtime.require(runtime.permissions.storage, "storage")?;
    anyhow::ensure!(valid_key(key), "invalid storage key");
    let mut map = runtime.load_storage()?;
    map.remove(key);
    runtime.save_storage(&map)
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct DocReadRequest {
    offset: usize,
    limit: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DocReadResponse<'a> {
    title: &'a str,
    total: usize,
    blocks: &'a [crate::DocBlock],
    truncated: bool,
}

/// Read a page of the active document. The request is JSON:
/// `{"offset":0,"limit":100}`; both fields are optional.
pub fn doc_read(runtime: &PluginRuntime, request: &str) -> anyhow::Result<String> {
    runtime.require(runtime.permissions.doc_read, "docRead")?;
    let request: DocReadRequest = if request.trim().is_empty() {
        DocReadRequest::default()
    } else {
        serde_json::from_str(request).map_err(|_| anyhow::anyhow!("invalid doc read request"))?
    };
    let docs = runtime.docs.read().map_err(|_| anyhow::anyhow!("document context unavailable"))?;
    let Some(doc) = docs.as_ref() else {
        return Ok(r#"{"title":"","total":0,"blocks":[],"truncated":false}"#.to_string());
    };
    let limit = request.limit.clamp(1, MAX_DOC_PAGE_BLOCKS);
    let start = request.offset.min(doc.blocks.len());
    let mut end = start;
    let mut bytes = 0usize;
    while end < doc.blocks.len() && end - start < limit {
        let size = doc.blocks[end].text.len();
        if end > start && bytes + size > MAX_DOC_PAGE_BYTES {
            break;
        }
        bytes += size;
        end += 1;
    }
    Ok(serde_json::to_string(&DocReadResponse {
        title: &doc.title,
        total: doc.blocks.len(),
        blocks: &doc.blocks[start..end],
        truncated: end < doc.blocks.len(),
    })?)
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct FileReadRequest {
    offset: u64,
    limit: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FileReadResponse {
    offset: u64,
    data: String,
    eof: bool,
}

/// Read one base64 chunk of the file currently being parsed.
pub fn file_read(runtime: &PluginRuntime, request: &str) -> anyhow::Result<String> {
    let job = runtime
        .parse
        .lock()
        .map_err(|_| anyhow::anyhow!("parse scope is unavailable"))?
        .clone()
        .ok_or_else(|| anyhow::anyhow!("file access is only available while a document is parsed"))?;
    let request: FileReadRequest = if request.trim().is_empty() {
        FileReadRequest::default()
    } else {
        serde_json::from_str(request).map_err(|_| anyhow::anyhow!("invalid file read request"))?
    };
    let offset = request.offset.min(job.size);
    let remaining = job.size.saturating_sub(offset);
    let requested = if request.limit == 0 {
        MAX_PARSER_CHUNK_BYTES as u64
    } else {
        request.limit
    };
    let limit = (requested as usize)
        .min(MAX_PARSER_CHUNK_BYTES)
        .min(remaining as usize);
    let mut file = std::fs::File::open(&job.path)?;
    file.seek(SeekFrom::Start(offset))?;
    let mut buffer = Vec::with_capacity(limit);
    let read = file.take(limit as u64).read_to_end(&mut buffer)?;
    Ok(serde_json::to_string(&FileReadResponse {
        offset,
        data: base64::engine::general_purpose::STANDARD.encode(&buffer),
        eof: offset + read as u64 >= job.size,
    })?)
}

pub fn log_message(runtime: &PluginRuntime, message: &str) {
    let message: String = message.chars().take(4096).collect();
    eprintln!("[plugin:{}] {message}", runtime.name);
}

fn context(user_data: &UserData<Arc<PluginRuntime>>) -> Result<Arc<PluginRuntime>, Error> {
    let shared = user_data.get()?;
    let guard = shared
        .lock()
        .map_err(|_| Error::msg("plugin runtime lock is poisoned"))?;
    Ok(guard.clone())
}

host_fn!(pub host_storage_get(user_data: Arc<PluginRuntime>; key: String) -> String {
    let runtime = context(&user_data)?;
    storage_get(&runtime, &key).map_err(|err| Error::msg(err.to_string()))
});

host_fn!(pub host_storage_set(user_data: Arc<PluginRuntime>; key: String, value: String) -> String {
    let runtime = context(&user_data)?;
    storage_set(&runtime, &key, &value).map_err(|err| Error::msg(err.to_string()))?;
    Ok(String::new())
});

host_fn!(pub host_storage_delete(user_data: Arc<PluginRuntime>; key: String) -> String {
    let runtime = context(&user_data)?;
    storage_delete(&runtime, &key).map_err(|err| Error::msg(err.to_string()))?;
    Ok(String::new())
});

host_fn!(pub host_doc_read(user_data: Arc<PluginRuntime>; request: String) -> String {
    let runtime = context(&user_data)?;
    doc_read(&runtime, &request).map_err(|err| Error::msg(err.to_string()))
});

host_fn!(pub host_file_read(user_data: Arc<PluginRuntime>; request: String) -> String {
    let runtime = context(&user_data)?;
    file_read(&runtime, &request).map_err(|err| Error::msg(err.to_string()))
});

host_fn!(pub host_log(user_data: Arc<PluginRuntime>; message: String) -> String {
    let runtime = context(&user_data)?;
    log_message(&runtime, &message);
    Ok(String::new())
});

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{DocBlock, PluginPermissions};

    struct TempDir(PathBuf);

    impl TempDir {
        fn new(tag: &str) -> Self {
            let unique = format!(
                "scholarust-runtime-test-{tag}-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            );
            let path = std::env::temp_dir().join(unique);
            std::fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn runtime(tag: &str, permissions: PluginPermissions) -> (TempDir, PluginRuntime) {
        let tmp = TempDir::new(tag);
        let runtime = PluginRuntime {
            name: "test".into(),
            dir: tmp.0.clone(),
            permissions,
            docs: empty_doc_context(),
            parse: empty_parse_scope(),
        };
        (tmp, runtime)
    }

    #[test]
    fn storage_round_trip_is_scoped_to_the_plugin_directory() {
        let (_tmp, rt) = runtime("storage", PluginPermissions { storage: true, ..Default::default() });
        storage_set(&rt, "theme", "dark").unwrap();
        assert_eq!(storage_get(&rt, "theme").unwrap(), "dark");
        assert!(rt.dir.join("storage.json").is_file());
        storage_delete(&rt, "theme").unwrap();
        assert_eq!(storage_get(&rt, "theme").unwrap(), "");
    }

    #[test]
    fn storage_denied_without_permission() {
        let (_tmp, rt) = runtime("storage-denied", PluginPermissions::default());
        assert!(storage_set(&rt, "a", "b").is_err());
        assert!(storage_get(&rt, "a").is_err());
    }

    #[test]
    fn storage_enforces_value_and_total_quota() {
        let (_tmp, rt) = runtime("storage-quota", PluginPermissions { storage: true, ..Default::default() });
        assert!(storage_set(&rt, "big", &"x".repeat(MAX_STORAGE_VALUE_BYTES + 1)).is_err());
        let chunk = "x".repeat(MAX_STORAGE_VALUE_BYTES);
        // JSON framing adds a little overhead, so leave room for one less value.
        for index in 0..MAX_STORAGE_BYTES / MAX_STORAGE_VALUE_BYTES - 1 {
            storage_set(&rt, &format!("k{index}"), &chunk).unwrap();
        }
        assert!(storage_set(&rt, "overflow", &chunk).is_err());
    }

    #[test]
    fn doc_read_requires_permission_and_pages_blocks() {
        let (_tmp, mut rt) = runtime("doc", PluginPermissions { doc_read: true, ..Default::default() });
        let blocks = (0..5)
            .map(|id| DocBlock { id, kind: "paragraph".into(), text: format!("block {id}") })
            .collect();
        *rt.docs.write().unwrap() = Some(DocSnapshot { title: "Paper".into(), blocks });
        let page: serde_json::Value =
            serde_json::from_str(&doc_read(&rt, r#"{"offset":1,"limit":2}"#).unwrap()).unwrap();
        assert_eq!(page["title"], "Paper");
        assert_eq!(page["total"], 5);
        assert_eq!(page["blocks"].as_array().unwrap().len(), 2);
        assert_eq!(page["blocks"][0]["id"], 1);
        assert_eq!(page["truncated"], true);
        assert!(doc_read(&rt, "not json").is_err());

        rt.permissions.doc_read = false;
        assert!(doc_read(&rt, "").is_err());
    }

    #[test]
    fn doc_read_without_an_open_document_is_empty() {
        let (_tmp, rt) = runtime("doc-empty", PluginPermissions { doc_read: true, ..Default::default() });
        let page: serde_json::Value = serde_json::from_str(&doc_read(&rt, "").unwrap()).unwrap();
        assert_eq!(page["total"], 0);
        assert_eq!(page["blocks"].as_array().unwrap().len(), 0);
    }

    #[test]
    fn file_read_is_scoped_to_the_active_parse_job() {
        let (tmp, rt) = runtime("file-scope", PluginPermissions::default());
        let path = tmp.0.join("sample.bin");
        std::fs::write(&path, b"hello world").unwrap();
        assert!(file_read(&rt, r#"{"offset":0,"limit":5}"#).is_err());

        *rt.parse.lock().unwrap() = Some(ParseJob { path, size: 11 });
        let page: serde_json::Value =
            serde_json::from_str(&file_read(&rt, r#"{"offset":6,"limit":1024}"#).unwrap()).unwrap();
        assert_eq!(page["offset"], 6);
        assert_eq!(page["eof"], true);
        let decoded = base64::engine::general_purpose::STANDARD
            .decode(page["data"].as_str().unwrap())
            .unwrap();
        assert_eq!(decoded, b"world");

        let page: serde_json::Value =
            serde_json::from_str(&file_read(&rt, "").unwrap()).unwrap();
        assert_eq!(page["eof"], true);
        let decoded = base64::engine::general_purpose::STANDARD
            .decode(page["data"].as_str().unwrap())
            .unwrap();
        assert_eq!(decoded, b"hello world");

        *rt.parse.lock().unwrap() = None;
        assert!(file_read(&rt, "").is_err());
    }
}
