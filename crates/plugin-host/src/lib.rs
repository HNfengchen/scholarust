use anyhow::Context;
use async_trait::async_trait;
use extism::{Manifest, PluginBuilder, UserData, Wasm, WasmMetadata, PTR};
use scholarust_translate::TranslateService;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::Read;
use std::path::Path;
use std::sync::Arc;
use tokio::sync::Mutex;
use zip::ZipArchive;

mod runtime;

pub use runtime::{
    empty_doc_context, DocContext, CALL_FUEL, CALL_TIMEOUT, INIT_FUEL, MAX_DOC_BLOCKS,
    MAX_DOC_TEXT_BYTES, MAX_INPUT_BYTES, MAX_MEMORY_PAGES, MAX_OUTPUT_BYTES, MAX_PARSER_CHUNK_BYTES,
    MAX_WASM_BYTES,
};

/// The host API version this build understands. Manifests without
/// `apiVersion` are treated as version 1, so existing plugins keep loading.
pub const HOST_API_VERSION: u32 = 2;
const MAX_HTTP_HOSTS: usize = 32;
const MAX_PANELS: usize = 8;
const MAX_PANEL_SECTIONS: usize = 32;
const MAX_PANEL_ITEMS: usize = 200;
const MAX_PANEL_TEXT_BYTES: usize = 64 * 1024;

fn default_api_version() -> u32 {
    1
}

fn default_enabled() -> bool {
    true
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PluginKind {
    #[default]
    Translate,
    /// A plugin that only contributes declarative panels.
    Panel,
    /// A plugin that parses custom document formats via an `extract` export.
    Parser,
    #[serde(other)]
    Other,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct PluginPermissions {
    /// Read-only access to the document the user currently has open.
    pub doc_read: bool,
    /// A namespaced, per-plugin persistent key/value store.
    pub storage: bool,
    /// Host whitelist for Extism's HTTP host function. Empty means no network.
    pub http: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PanelKeyValue {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum PanelSection {
    Paragraph { text: String },
    List { items: Vec<String> },
    KeyValue { items: Vec<PanelKeyValue> },
}

const PANEL_ICONS: [&str; 6] = ["info", "list", "table", "book", "notes", "sparkle"];

fn default_panel_icon() -> String {
    "info".into()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PanelContribution {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub description: String,
    #[serde(default = "default_panel_icon")]
    pub icon: String,
    /// When true the host asks the plugin's `panel` export for live sections
    /// instead of rendering the static `sections` below.
    #[serde(default)]
    pub dynamic: bool,
    #[serde(default)]
    pub sections: Vec<PanelSection>,
}

const BUILTIN_EXTENSIONS: [&str; 7] = ["pdf", "epub", "docx", "md", "markdown", "txt", "text"];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParserContribution {
    pub id: String,
    #[serde(default)]
    pub label: String,
    /// Lowercase extensions this parser claims, e.g. ["foo", "bar"].
    pub extensions: Vec<String>,
    /// Hex byte signatures matched at offset 0, for files without a useful
    /// extension, e.g. ["504b0304"].
    #[serde(default)]
    pub magic: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct PluginContributions {
    pub panels: Vec<PanelContribution>,
    pub parsers: Vec<ParserContribution>,
}

/// Result of a parser plugin. Blocks reuse the reader's block vocabulary so the
/// existing reading view, outline and per-block translation work unchanged.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedDocument {
    pub title: Option<String>,
    pub notice: Option<String>,
    pub blocks: Vec<ParsedBlock>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedBlock {
    pub id: u32,
    pub kind: String,
    pub text: String,
    pub level: u32,
    /// `data:image/...;base64,...` payload for `figure` blocks.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub image: Option<String>,
}

/// Total file size a parser may stream through `sr_file_read`.
pub const MAX_PARSER_FILE_BYTES: usize = 64 * 1024 * 1024;
const MAX_PARSER_BLOCKS: usize = 20_000;
const MAX_PARSER_TEXT_BYTES: usize = 8 * 1024 * 1024;
const MAX_PARSER_TITLE_BYTES: usize = 500;
const MAX_PARSER_NOTICE_BYTES: usize = 4096;
const MAX_PARSER_IMAGE_BYTES: usize = 2 * 1024 * 1024;
const MAX_PARSER_IMAGE_TOTAL: usize = 16 * 1024 * 1024;
const PARSED_BLOCK_KINDS: [&str; 10] = [
    "title",
    "heading",
    "abstract",
    "paragraph",
    "note",
    "reference",
    "references",
    "caption",
    "meta",
    "figure",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginManifest {
    pub name: String,
    pub version: String,
    #[serde(default)]
    pub description: String,
    /// wasm file name relative to the plugin directory
    pub entry: String,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    #[serde(default = "default_api_version")]
    pub api_version: u32,
    #[serde(default)]
    pub kind: PluginKind,
    #[serde(default)]
    pub permissions: PluginPermissions,
    #[serde(default)]
    pub contributes: PluginContributions,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginInfo {
    pub name: String,
    pub version: String,
    pub description: String,
    pub enabled: bool,
    pub api_version: u32,
    pub kind: PluginKind,
    pub permissions: PluginPermissions,
    pub contributes: PluginContributions,
    /// Set when the runtime skipped a capability because another enabled
    /// plugin already claims the same extension.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub conflict: Option<String>,
}

/// A loaded parser plugin, kept so custom formats can be parsed on demand.
#[derive(Clone)]
pub struct LoadedParser {
    pub info: PluginInfo,
    pub claims: Vec<ParserContribution>,
    plugin: Arc<Mutex<extism::Plugin>>,
    parse: runtime::ParseScope,
}

/// A plugin that serves live content for its dynamic panels.
#[derive(Clone)]
pub struct LoadedPanel {
    pub info: PluginInfo,
    plugin: Arc<Mutex<extism::Plugin>>,
}

impl LoadedPanel {
    pub fn has_panel(&self, panel_id: &str) -> bool {
        self.info
            .contributes
            .panels
            .iter()
            .any(|panel| panel.id == panel_id && panel.dynamic)
    }

    /// Ask the plugin for a panel's sections. The plugin may use any L2
    /// capability it declared; the host only validates the response shape.
    pub async fn sections(&self, panel_id: &str) -> anyhow::Result<Vec<PanelSection>> {
        anyhow::ensure!(self.has_panel(panel_id), "面板不存在或不是动态面板");
        let request = serde_json::json!({ "panelId": panel_id }).to_string();
        let mut plugin = self.plugin.lock().await;
        let output: Vec<u8> = plugin
            .call("panel", request.as_bytes())
            .context("panel plugin call failed")?;
        anyhow::ensure!(output.len() <= MAX_PANEL_TEXT_BYTES, "动态面板返回的内容过大");
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct RawPanel {
            #[serde(default)]
            sections: Vec<PanelSection>,
        }
        let raw: RawPanel = serde_json::from_slice(&output).context("动态面板返回了无效 JSON")?;
        validate_sections(&raw.sections)?;
        Ok(raw.sections)
    }
}

/// The extensions a loaded plugin provides. `parser` is `None` for
/// translate/panel plugins; `service` is `None` for non-translators. `panel`
/// is present when the plugin serves at least one dynamic panel.
pub struct LoadedPlugin {
    pub info: PluginInfo,
    pub service: Option<Arc<dyn TranslateService>>,
    pub parser: Option<LoadedParser>,
    pub panel: Option<LoadedPanel>,
}

impl LoadedParser {
    pub fn claims_extension(&self, extension: &str) -> bool {
        claims_extension(&self.claims, extension)
    }

    /// Parse a file through the plugin's `extract` export. The plugin receives
    /// the file name, extension and size, then streams the bytes with
    /// `sr_file_read`; it never receives a path or general filesystem access.
    pub async fn parse(&self, path: &Path, extension: &str) -> anyhow::Result<ParsedDocument> {
        let metadata = tokio::fs::metadata(path)
            .await
            .with_context(|| format!("failed to read {}", path.display()))?;
        anyhow::ensure!(
            metadata.len() <= MAX_PARSER_FILE_BYTES as u64,
            "文件超过解析插件上限（{} MiB）",
            MAX_PARSER_FILE_BYTES / (1024 * 1024)
        );
        let request = serde_json::json!({
            "name": path.file_name().and_then(|name| name.to_str()).unwrap_or("document"),
            "extension": extension,
            "size": metadata.len(),
        })
        .to_string();
        let mut plugin = self.plugin.lock().await;
        {
            let mut scope = self
                .parse
                .lock()
                .map_err(|_| anyhow::anyhow!("解析任务状态不可用"))?;
            *scope = Some(runtime::ParseJob {
                path: path.to_path_buf(),
                size: metadata.len(),
            });
        }
        let result = plugin.call("extract", request.as_bytes());
        if let Ok(mut scope) = self.parse.lock() {
            *scope = None;
        }
        let output: Vec<u8> = result.context("parser plugin extract call failed")?;
        parsed_from_output(&output)
    }
}

fn claims_extension(claims: &[ParserContribution], extension: &str) -> bool {
    claims.iter().any(|claim| {
        claim
            .extensions
            .iter()
            .any(|ext| ext.eq_ignore_ascii_case(extension))
    })
}

fn decode_hex(value: &str) -> Option<Vec<u8>> {
    if value.len() % 2 != 0 {
        return None;
    }
    (0..value.len())
        .step_by(2)
        .map(|index| u8::from_str_radix(&value[index..index + 2], 16).ok())
        .collect()
}

/// Whether a parser claims a file by its header bytes (magic signatures).
pub fn claims_magic(claims: &[ParserContribution], head: &[u8]) -> bool {
    claims.iter().any(|claim| {
        claim
            .magic
            .iter()
            .filter_map(|signature| decode_hex(signature.trim()))
            .any(|signature| !signature.is_empty() && head.starts_with(&signature))
    })
}

fn first_conflict(
    claims: &[ParserContribution],
    claimed: &[(String, String)],
) -> Option<(String, String)> {
    for claim in claims {
        for extension in &claim.extensions {
            let lower = extension.to_ascii_lowercase();
            if let Some((_, other)) = claimed.iter().find(|(existing, _)| *existing == lower) {
                return Some((lower, other.clone()));
            }
        }
    }
    None
}

fn extension_conflicts(plugins_dir: &Path, manifest: &PluginManifest) -> Vec<ExtensionConflict> {
    let mut conflicts = Vec::new();
    if manifest.contributes.parsers.is_empty() {
        return conflicts;
    }
    let Ok(entries) = std::fs::read_dir(plugins_dir) else {
        return conflicts;
    };
    for entry in entries.flatten() {
        let dir = entry.path();
        if !dir.is_dir() {
            continue;
        }
        let Ok(other) = read_manifest(&dir) else {
            continue;
        };
        if other.name == manifest.name || !other.enabled {
            continue;
        }
        for claim in &manifest.contributes.parsers {
            for extension in &claim.extensions {
                if claims_extension(&other.contributes.parsers, extension) {
                    conflicts.push(ExtensionConflict {
                        extension: extension.to_ascii_lowercase(),
                        plugin: other.name.clone(),
                    });
                }
            }
        }
    }
    conflicts
}

fn wasm_digest(wasm: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    Sha256::digest(wasm)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn compare_versions(previous: &str, next: &str) -> VersionChange {
    let previous = previous.trim().trim_start_matches('v');
    let next = next.trim().trim_start_matches('v');
    match (semver::Version::parse(previous), semver::Version::parse(next)) {
        (Ok(previous), Ok(next)) if next > previous => VersionChange::Upgrade,
        (Ok(previous), Ok(next)) if next < previous => VersionChange::Downgrade,
        (Ok(_), Ok(_)) => VersionChange::Same,
        _ if previous == next => VersionChange::Same,
        _ => VersionChange::Different,
    }
}

/// Validate the JSON a parser plugin returned. Kept separate from the plugin
/// call so the output contract is testable without a Wasm toolchain.
fn parsed_from_output(output: &[u8]) -> anyhow::Result<ParsedDocument> {
    anyhow::ensure!(output.len() <= MAX_OUTPUT_BYTES, "解析插件输出过大");
    let raw: RawParsed = serde_json::from_slice(output).context("解析插件返回了无效 JSON")?;
    if let Some(title) = &raw.title {
        anyhow::ensure!(title.len() <= MAX_PARSER_TITLE_BYTES, "解析插件标题过长");
    }
    if let Some(notice) = &raw.notice {
        anyhow::ensure!(notice.len() <= MAX_PARSER_NOTICE_BYTES, "解析插件提示过长");
    }
    anyhow::ensure!(raw.blocks.len() <= MAX_PARSER_BLOCKS, "解析插件返回的块过多");
    let mut total = 0usize;
    let mut image_total = 0usize;
    let mut blocks = Vec::with_capacity(raw.blocks.len());
    for (index, block) in raw.blocks.into_iter().enumerate() {
        let kind = if block.kind.trim().is_empty() {
            "paragraph".to_string()
        } else {
            block.kind
        };
        anyhow::ensure!(
            PARSED_BLOCK_KINDS.contains(&kind.as_str()),
            "解析插件返回了未知块类型: {kind}"
        );
        if let Some(image) = &block.image {
            anyhow::ensure!(kind == "figure", "只有 figure 块可以携带图片");
            anyhow::ensure!(
                image.len() <= MAX_PARSER_IMAGE_BYTES,
                "解析插件返回的图片过大"
            );
            anyhow::ensure!(
                image.starts_with("data:image/") && image.contains(";base64,"),
                "图片必须是 data:image/...;base64 数据"
            );
            let payload = image.split_once(";base64,").map(|(_, rest)| rest).unwrap_or("");
            anyhow::ensure!(
                payload.bytes().all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'+' | b'/' | b'=')),
                "图片数据不是有效的 base64"
            );
            image_total += image.len();
            anyhow::ensure!(image_total <= MAX_PARSER_IMAGE_TOTAL, "解析插件返回的图片总大小过大");
        } else {
            anyhow::ensure!(kind != "figure", "figure 块必须携带图片");
        }
        total += block.text.len();
        anyhow::ensure!(total <= MAX_PARSER_TEXT_BYTES, "解析插件返回的文本过多");
        blocks.push(ParsedBlock {
            id: index as u32,
            kind,
            text: block.text,
            level: block.level.min(6),
            image: block.image,
        });
    }
    Ok(ParsedDocument {
        title: raw.title,
        notice: raw.notice,
        blocks,
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawParsed {
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    notice: Option<String>,
    #[serde(default)]
    blocks: Vec<RawBlock>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawBlock {
    #[serde(default)]
    kind: String,
    #[serde(default)]
    text: String,
    #[serde(default)]
    level: u32,
    #[serde(default)]
    image: Option<String>,
}

impl PluginInfo {
    fn from_manifest(manifest: &PluginManifest) -> Self {
        Self {
            name: manifest.name.clone(),
            version: manifest.version.clone(),
            description: manifest.description.clone(),
            enabled: manifest.enabled,
            api_version: manifest.api_version,
            kind: manifest.kind,
            permissions: manifest.permissions.clone(),
            contributes: manifest.contributes.clone(),
            conflict: None,
        }
    }
}

/// The document shape shared with plugins that declare `docRead`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocSnapshot {
    pub title: String,
    #[serde(default)]
    pub blocks: Vec<DocBlock>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocBlock {
    pub id: u32,
    pub kind: String,
    pub text: String,
}

/// Plugin names double as directory names under `plugins/`, so they must be
/// safe single path components. Unicode names (e.g. Chinese) are allowed.
pub fn validate_name(name: &str) -> anyhow::Result<()> {
    if name.is_empty() {
        anyhow::bail!("plugin name must not be empty");
    }
    if name.contains('/') || name.contains('\\') {
        anyhow::bail!("plugin name must not contain path separators: {name}");
    }
    if name.contains("..") {
        anyhow::bail!("plugin name must not contain '..': {name}");
    }
    if name.chars().any(|c| c.is_control()) {
        anyhow::bail!("plugin name must not contain control characters");
    }
    if name.starts_with('.') {
        anyhow::bail!("plugin name must not start with '.': {name}");
    }
    Ok(())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum VersionChange {
    New,
    Upgrade,
    Downgrade,
    Same,
    Different,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionConflict {
    pub extension: String,
    pub plugin: String,
}

/// Everything the UI needs to ask for informed consent before installing.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginPreview {
    pub info: PluginInfo,
    /// SHA-256 of the package's wasm entry.
    pub digest: String,
    pub installed: Option<PluginInfo>,
    pub version_change: VersionChange,
    /// Extensions already claimed by *other* enabled plugins.
    pub conflicts: Vec<ExtensionConflict>,
}

struct PluginPackage {
    manifest: PluginManifest,
    wasm: Vec<u8>,
    readme: Option<String>,
}

/// Loads WASM plugins (Extism runtime). A `translate` plugin exports
/// `translate`: JSON in {"raw","targetLang"} -> JSON out {"result"} and is
/// registered as an extra translation service. A `panel` plugin only carries
/// declarative UI contributions. Both kinds share the same L1 limits and L2
/// host capabilities.
pub struct PluginHost {
    pub plugins: Vec<PluginInfo>,
    pub services: Vec<Arc<dyn TranslateService>>,
    pub parsers: Vec<LoadedParser>,
    pub panels: Vec<LoadedPanel>,
    docs: DocContext,
}

impl PluginHost {
    pub fn load_dir(dir: &Path) -> Self {
        Self::load_dir_with_context(dir, empty_doc_context())
    }

    pub fn load_dir_with_context(dir: &Path, docs: DocContext) -> Self {
        let mut host = Self {
            plugins: Vec::new(),
            services: Vec::new(),
            parsers: Vec::new(),
            panels: Vec::new(),
            docs,
        };
        let Ok(entries) = std::fs::read_dir(dir) else {
            return host;
        };
        let mut claimed: Vec<(String, String)> = Vec::new();
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            match Self::load_one(&path, &host.docs) {
                Ok(mut loaded) => {
                    if let Some(service) = loaded.service {
                        host.services.push(service);
                    }
                    if let Some(parser) = loaded.parser {
                        if let Some((extension, other)) = first_conflict(&parser.claims, &claimed) {
                            let message = format!(".{extension} 已被插件「{other}」使用");
                            eprintln!("plugin {}: {message}", loaded.info.name);
                            loaded.info.conflict = Some(message);
                        } else {
                            for claim in &parser.claims {
                                for extension in &claim.extensions {
                                    claimed.push((extension.to_ascii_lowercase(), loaded.info.name.clone()));
                                }
                            }
                            host.parsers.push(parser);
                        }
                    }
                    if let Some(panel) = loaded.panel {
                        host.panels.push(panel);
                    }
                    host.plugins.push(loaded.info);
                }
                Err(err) => {
                    eprintln!("failed to load plugin {}: {err}", path.display());
                }
            }
        }
        host
    }

    /// Loads a plugin directory. Disabled plugins yield info only; enabled
    /// plugins yield info plus a live service when they are translators.
    fn load_one(dir: &Path, docs: &DocContext) -> anyhow::Result<LoadedPlugin> {
        let manifest = read_manifest(dir)?;
        validate_manifest(&manifest)?;
        let info = PluginInfo::from_manifest(&manifest);
        if manifest.enabled {
            instantiate_plugin(dir, &manifest, info, docs.clone())
        } else {
            Ok(LoadedPlugin { info, service: None, parser: None, panel: None })
        }
    }

    /// Loads the manifest (whatever its `enabled` value) and instantiates the
    /// extension. Used right after import / enable.
    pub fn load_plugin(dir: &Path, docs: DocContext) -> anyhow::Result<LoadedPlugin> {
        let manifest = read_manifest(dir)?;
        validate_manifest(&manifest)?;
        let info = PluginInfo::from_manifest(&manifest);
        instantiate_plugin(dir, &manifest, info, docs)
    }

    /// Reads and validates a plugin package without touching the plugins
    /// directory. `plugin.json` may sit at the archive root or under a single
    /// top-level folder.
    fn read_package(zip_path: &Path) -> anyhow::Result<PluginPackage> {
        let file = std::fs::File::open(zip_path)
            .with_context(|| format!("failed to open plugin zip: {}", zip_path.display()))?;
        let mut archive = ZipArchive::new(file).context("invalid zip archive")?;

        // Index file entries by normalized name (zip uses '/', be lenient
        // about '\\' produced by some Windows archivers).
        let mut entries: HashMap<String, usize> = HashMap::new();
        for i in 0..archive.len() {
            let entry = archive.by_index(i).context("failed to read zip entry")?;
            if entry.is_dir() {
                continue;
            }
            let name = entry.name().replace('\\', "/").trim_end_matches('/').to_string();
            entries.insert(name, i);
        }

        // Exactly one plugin.json: at root or under a single top-level folder.
        let mut prefixes: Vec<String> = Vec::new();
        if entries.contains_key("plugin.json") {
            prefixes.push(String::new());
        }
        for name in entries.keys() {
            if let Some(folder) = name.strip_suffix("/plugin.json") {
                if !folder.is_empty() && !folder.contains('/') {
                    prefixes.push(format!("{folder}/"));
                }
            }
        }
        let prefix = match prefixes.len() {
            0 => anyhow::bail!("zip does not contain a plugin.json"),
            1 => prefixes.remove(0),
            _ => anyhow::bail!("zip contains multiple plugin.json candidates"),
        };

        let manifest_index = entries[&format!("{prefix}plugin.json")];
        let mut manifest_text = String::new();
        archive
            .by_index(manifest_index)
            .context("failed to read plugin.json from zip")?
            .read_to_string(&mut manifest_text)
            .context("failed to read plugin.json from zip")?;
        let manifest: PluginManifest =
            serde_json::from_str(&manifest_text).context("invalid plugin.json")?;
        validate_manifest(&manifest)?;

        let wasm_name = format!("{prefix}{}", manifest.entry);
        let wasm_index = *entries
            .get(&wasm_name)
            .with_context(|| format!("zip is missing wasm entry: {wasm_name}"))?;
        let mut wasm = Vec::new();
        archive
            .by_index(wasm_index)
            .context("failed to read wasm from zip")?
            .read_to_end(&mut wasm)
            .context("failed to read wasm from zip")?;

        let readme = match entries.get(&format!("{prefix}README.md")) {
            Some(&readme_index) => {
                let mut readme = String::new();
                archive
                    .by_index(readme_index)
                    .context("failed to read README.md from zip")?
                    .read_to_string(&mut readme)
                    .context("failed to read README.md from zip")?;
                Some(readme)
            }
            None => None,
        };

        Ok(PluginPackage { manifest, wasm, readme })
    }

    /// Describes what installing this package would do: identity, digest,
    /// version change and any extension already claimed by another plugin.
    /// The UI shows this before asking for consent.
    pub fn inspect_zip(zip_path: &Path, plugins_dir: &Path) -> anyhow::Result<PluginPreview> {
        let package = Self::read_package(zip_path)?;
        let installed = read_manifest(&plugins_dir.join(&package.manifest.name))
            .ok()
            .map(|manifest| PluginInfo::from_manifest(&manifest));
        Ok(PluginPreview {
            info: PluginInfo::from_manifest(&package.manifest),
            digest: wasm_digest(&package.wasm),
            version_change: match &installed {
                None => VersionChange::New,
                Some(previous) => compare_versions(&previous.version, &package.manifest.version),
            },
            installed,
            conflicts: extension_conflicts(plugins_dir, &package.manifest),
        })
    }

    /// Installs a plugin from a ZIP package. The wasm is instantiated and its
    /// exports are checked before anything is written to disk. Installing over
    /// an existing plugin of the same name upgrades it in place; a package
    /// whose extensions collide with another enabled plugin is rejected.
    pub fn install_zip(zip_path: &Path, plugins_dir: &Path) -> anyhow::Result<PluginInfo> {
        let PluginPackage { manifest, wasm, readme } = Self::read_package(zip_path)?;
        let conflicts = extension_conflicts(plugins_dir, &manifest);
        if !conflicts.is_empty() {
            let detail = conflicts
                .iter()
                .map(|conflict| format!(".{} 已被「{}」使用", conflict.extension, conflict.plugin))
                .collect::<Vec<_>>()
                .join("，");
            anyhow::bail!("扩展名冲突：{detail}。请先停用或卸载对应插件。");
        }

        // Validate before touching the plugins directory; the probe runs under
        // the same fuel/memory/timeout limits as a real instance.
        let target = plugins_dir.join(&manifest.name);
        {
            let probe = build_plugin(&manifest.name, &target, &manifest, wasm.clone(), empty_doc_context())
                .context("failed to instantiate wasm")?
                .0;
            validate_exports(&probe, &manifest)?;
        }

        if target.exists() {
            std::fs::remove_dir_all(&target)
                .with_context(|| format!("failed to replace existing plugin: {}", manifest.name))?;
        }
        std::fs::create_dir_all(&target).context("failed to create plugin directory")?;
        // `entry` was validated as a plain file name, so serialize as-is.
        std::fs::write(
            target.join("plugin.json"),
            serde_json::to_string_pretty(&manifest).context("failed to serialize plugin.json")?,
        )
        .context("failed to write plugin.json")?;
        std::fs::write(target.join(&manifest.entry), &wasm)
            .with_context(|| format!("failed to write wasm entry: {}", manifest.entry))?;

        if let Some(readme) = readme {
            std::fs::write(target.join("README.md"), readme)
                .context("failed to write plugin README.md")?;
        }

        Ok(PluginInfo::from_manifest(&manifest))
    }

    /// Reads a plugin's bundled README.md; returns an empty string when the
    /// plugin ships none. The name is validated before touching the filesystem.
    pub fn read_readme(plugins_dir: &Path, name: &str) -> anyhow::Result<String> {
        validate_name(name)?;
        let path = plugins_dir.join(name).join("README.md");
        match std::fs::read_to_string(&path) {
            Ok(text) => Ok(text),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
            Err(e) => Err(e).with_context(|| format!("failed to read README for plugin: {name}")),
        }
    }

    /// Persists the enabled flag in the plugin's plugin.json.
    pub fn set_enabled(plugins_dir: &Path, name: &str, enabled: bool) -> anyhow::Result<()> {
        validate_name(name)?;
        let file = plugins_dir.join(name).join("plugin.json");
        let mut manifest = read_manifest(&plugins_dir.join(name))?;
        manifest.enabled = enabled;
        std::fs::write(
            &file,
            serde_json::to_string_pretty(&manifest).context("failed to serialize plugin.json")?,
        )
        .with_context(|| format!("failed to write plugin.json for plugin: {name}"))?;
        Ok(())
    }

    /// Removes the plugin directory entirely.
    pub fn uninstall(plugins_dir: &Path, name: &str) -> anyhow::Result<()> {
        validate_name(name)?;
        let dir = plugins_dir.join(name);
        std::fs::remove_dir_all(&dir)
            .with_context(|| format!("failed to remove plugin: {name}"))?;
        Ok(())
    }
}

fn read_manifest(dir: &Path) -> anyhow::Result<PluginManifest> {
    serde_json::from_str(&std::fs::read_to_string(dir.join("plugin.json"))?)
        .context("invalid plugin.json")
}

fn validate_manifest(manifest: &PluginManifest) -> anyhow::Result<()> {
    validate_name(&manifest.name)?;
    if manifest.version.trim().is_empty() {
        anyhow::bail!("plugin version must not be empty");
    }
    if manifest.api_version == 0 || manifest.api_version > HOST_API_VERSION {
        anyhow::bail!(
            "plugin apiVersion {} is not supported by this host (1..={HOST_API_VERSION})",
            manifest.api_version
        );
    }
    if manifest.entry.is_empty()
        || manifest.entry.contains("..")
        || manifest.entry.contains('/')
        || manifest.entry.contains('\\')
        || manifest.entry.contains(':')
    {
        anyhow::bail!("invalid wasm entry (must be a plain file name): {}", manifest.entry);
    }
    match manifest.kind {
        PluginKind::Translate | PluginKind::Panel | PluginKind::Parser => {}
        PluginKind::Other => anyhow::bail!("该插件类型尚未开放"),
    }
    if manifest.permissions.http.len() > MAX_HTTP_HOSTS {
        anyhow::bail!("too many HTTP hosts (max {MAX_HTTP_HOSTS})");
    }
    for host in &manifest.permissions.http {
        validate_http_host(host)?;
    }
    if manifest.contributions_size() > MAX_PANEL_TEXT_BYTES {
        anyhow::bail!("declarative panel content is too large");
    }
    if manifest.contributes.panels.len() > MAX_PANELS {
        anyhow::bail!("too many contributed panels (max {MAX_PANELS})");
    }
    if manifest.kind == PluginKind::Panel && manifest.contributes.panels.is_empty() {
        anyhow::bail!("a panel plugin must contribute at least one panel");
    }
    if manifest.kind != PluginKind::Parser && !manifest.contributes.parsers.is_empty() {
        anyhow::bail!("only parser plugins may declare contributes.parsers");
    }
    if manifest.kind == PluginKind::Parser && manifest.contributes.parsers.is_empty() {
        anyhow::bail!("a parser plugin must claim at least one extension");
    }
    let mut seen_extensions = std::collections::HashSet::new();
    for parser in &manifest.contributes.parsers {
        let id = parser.id.trim();
        if id.is_empty()
            || id.len() > 64
            || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        {
            anyhow::bail!("invalid parser id (use letters, digits, '-' or '_')");
        }
        if parser.label.len() > 80 {
            anyhow::bail!("parser label is too long");
        }
        if parser.extensions.is_empty() || parser.extensions.len() > 16 {
            anyhow::bail!("a parser must claim between 1 and 16 extensions");
        }
        for extension in &parser.extensions {
            let ext = extension.trim();
            if ext.is_empty()
                || ext.len() > 16
                || !ext.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
            {
                anyhow::bail!("invalid extension: {extension:?}");
            }
            let lower = ext.to_ascii_lowercase();
            if BUILTIN_EXTENSIONS.contains(&lower.as_str()) {
                anyhow::bail!("extension .{ext} is handled by a built-in reader");
            }
            if !seen_extensions.insert(lower) {
                anyhow::bail!("duplicate parser extension: .{ext}");
            }
        }
        if parser.magic.len() > 8 {
            anyhow::bail!("a parser may declare at most 8 magic signatures");
        }
        for magic in &parser.magic {
            let bytes = magic.trim();
            if bytes.len() < 2
                || bytes.len() > 64
                || bytes.len() % 2 != 0
                || !bytes.bytes().all(|byte| byte.is_ascii_hexdigit())
            {
                anyhow::bail!("invalid magic signature (expected an even-length hex string): {magic:?}");
            }
        }
    }
    for panel in &manifest.contributes.panels {
        let id = panel.id.trim();
        if id.is_empty()
            || id.len() > 64
            || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        {
            anyhow::bail!("invalid panel id (use letters, digits, '-' or '_')");
        }
        if panel.title.trim().is_empty() || panel.title.len() > 120 {
            anyhow::bail!("invalid panel title");
        }
        if !PANEL_ICONS.contains(&panel.icon.as_str()) {
            anyhow::bail!("invalid panel icon: {}", panel.icon);
        }
        if panel.description.len() > 500 || panel.sections.len() > MAX_PANEL_SECTIONS {
            anyhow::bail!("panel content is too large");
        }
        validate_sections(&panel.sections)?;
    }
    Ok(())
}

fn validate_sections(sections: &[PanelSection]) -> anyhow::Result<()> {
    if sections.len() > MAX_PANEL_SECTIONS {
        anyhow::bail!("panel content is too large");
    }
    for section in sections {
        let (text_len, lengths, count): (Option<usize>, Vec<usize>, usize) = match section {
            PanelSection::Paragraph { text } => (Some(text.len()), vec![], 1),
            PanelSection::List { items } => {
                (None, items.iter().map(String::len).collect(), items.len())
            }
            PanelSection::KeyValue { items } => (
                None,
                items.iter().flat_map(|item| [item.key.len(), item.value.len()]).collect(),
                items.len(),
            ),
        };
        if text_len.is_some_and(|len| len > 16 * 1024)
            || lengths.iter().any(|len| *len > 4 * 1024)
            || count > MAX_PANEL_ITEMS
        {
            anyhow::bail!("panel content is too large");
        }
    }
    Ok(())
}

fn validate_http_host(host: &str) -> anyhow::Result<()> {
    let host = host.trim();
    if host.is_empty() || host.len() > 253 || host.chars().any(|c| c.is_whitespace() || c.is_control()) {
        anyhow::bail!("invalid HTTP host: {host:?}");
    }
    if host == "*" || host == "**" || host.chars().all(|c| c == '*' || c == '.') {
        anyhow::bail!("wildcard-only HTTP host is not allowed");
    }
    let lower = host.to_ascii_lowercase();
    let blocked = lower == "localhost"
        || lower == "127.0.0.1"
        || lower == "0.0.0.0"
        || lower == "::1"
        || lower.ends_with(".localhost")
        || lower.ends_with(".local")
        || lower.contains("127.")
        || lower.starts_with("10.")
        || lower.starts_with("192.168.")
        || (lower.starts_with("172.")
            && lower
                .split('.')
                .nth(1)
                .and_then(|octet| octet.parse::<u8>().ok())
                .is_some_and(|octet| (16..=31).contains(&octet)));
    if blocked {
        anyhow::bail!("HTTP host must not point at the local machine or a private network: {host}");
    }
    Ok(())
}

fn validate_exports(plugin: &extism::Plugin, manifest: &PluginManifest) -> anyhow::Result<()> {
    match manifest.kind {
        PluginKind::Translate if !plugin.function_exists("translate") => {
            anyhow::bail!("plugin does not export a 'translate' function")
        }
        PluginKind::Parser if !plugin.function_exists("extract") => {
            anyhow::bail!("parser plugin does not export an 'extract' function")
        }
        _ => {}
    }
    if manifest.contributes.panels.iter().any(|panel| panel.dynamic)
        && !plugin.function_exists("panel")
    {
        anyhow::bail!("dynamic panels require a 'panel' export");
    }
    Ok(())
}

impl PluginManifest {
    fn contributions_size(&self) -> usize {
        self.contributes
            .panels
            .iter()
            .map(|panel| {
                panel.description.len()
                    + panel
                        .sections
                        .iter()
                        .map(|section| match section {
                            PanelSection::Paragraph { text } => text.len(),
                            PanelSection::List { items } => items.iter().map(String::len).sum(),
                            PanelSection::KeyValue { items } => {
                                items.iter().map(|item| item.key.len() + item.value.len()).sum()
                            }
                        })
                        .sum::<usize>()
            })
            .sum::<usize>()
            + self
                .contributes
                .parsers
                .iter()
                .map(|parser| parser.label.len() + parser.extensions.iter().map(String::len).sum::<usize>())
                .sum::<usize>()
    }
}

fn build_plugin(
    name: &str,
    dir: &Path,
    manifest: &PluginManifest,
    wasm: Vec<u8>,
    docs: DocContext,
) -> anyhow::Result<(extism::Plugin, runtime::ParseScope)> {
    anyhow::ensure!(
        wasm.len() <= MAX_WASM_BYTES,
        "wasm entry is too large (max {MAX_WASM_BYTES} bytes)"
    );
    let memory = extism_manifest::MemoryOptions::new()
        .with_max_pages(MAX_MEMORY_PAGES)
        .with_max_http_response_bytes(MAX_OUTPUT_BYTES as u64)
        .with_max_var_bytes(256 * 1024);
    let mut source = Manifest::new([Wasm::Data {
        data: wasm,
        meta: WasmMetadata::default(),
    }])
    .with_memory_options(memory)
    .with_timeout(CALL_TIMEOUT);
    source = if manifest.permissions.http.is_empty() {
        source.disallow_all_hosts()
    } else {
        source.with_allowed_hosts(manifest.permissions.http.clone().into_iter())
    };
    let runtime = Arc::new(runtime::PluginRuntime {
        name: name.to_string(),
        dir: dir.to_path_buf(),
        permissions: manifest.permissions.clone(),
        docs,
        parse: runtime::empty_parse_scope(),
    });
    let parse = runtime.parse.clone();
    let plugin = PluginBuilder::new(source)
        .with_wasi(true)
        .with_fuel_limit(CALL_FUEL)
        .with_initialization_fuel_limit(INIT_FUEL)
        .with_function("sr_storage_get", [PTR], [PTR], UserData::new(runtime.clone()), runtime::host_storage_get)
        .with_function("sr_storage_set", [PTR], [PTR], UserData::new(runtime.clone()), runtime::host_storage_set)
        .with_function("sr_storage_delete", [PTR], [PTR], UserData::new(runtime.clone()), runtime::host_storage_delete)
        .with_function("sr_doc_read", [PTR], [PTR], UserData::new(runtime.clone()), runtime::host_doc_read)
        .with_function("sr_file_read", [PTR], [PTR], UserData::new(runtime.clone()), runtime::host_file_read)
        .with_function("sr_log", [PTR], [PTR], UserData::new(runtime), runtime::host_log)
        .build()
        .context("failed to instantiate wasm")?;
    Ok((plugin, parse))
}

fn instantiate_plugin(
    dir: &Path,
    manifest: &PluginManifest,
    info: PluginInfo,
    docs: DocContext,
) -> anyhow::Result<LoadedPlugin> {
    let wasm = std::fs::read(dir.join(&manifest.entry))
        .with_context(|| format!("missing wasm entry: {}", manifest.entry))?;
    let (plugin, parse) = build_plugin(&manifest.name, dir, manifest, wasm, docs)?;
    validate_exports(&plugin, manifest)?;
    let plugin = Arc::new(Mutex::new(plugin));
    let dynamic = manifest.contributes.panels.iter().any(|panel| panel.dynamic);
    let panel = dynamic.then(|| LoadedPanel {
        info: info.clone(),
        plugin: plugin.clone(),
    });
    match manifest.kind {
        PluginKind::Translate => Ok(LoadedPlugin {
            info,
            service: Some(Arc::new(PluginTranslateService {
                id: format!("plugin:{}", manifest.name),
                name: manifest.name.clone(),
                plugin,
            })),
            parser: None,
            panel,
        }),
        PluginKind::Parser => Ok(LoadedPlugin {
            info: info.clone(),
            service: None,
            parser: Some(LoadedParser {
                info,
                claims: manifest.contributes.parsers.clone(),
                plugin,
                parse,
            }),
            panel,
        }),
        _ => Ok(LoadedPlugin { info, service: None, parser: None, panel }),
    }
}

struct PluginTranslateService {
    id: String,
    name: String,
    plugin: Arc<Mutex<extism::Plugin>>,
}

#[async_trait]
impl TranslateService for PluginTranslateService {
    fn id(&self) -> &str {
        &self.id
    }

    fn name(&self) -> &str {
        &self.name
    }

    async fn translate(
        &self,
        raw: &str,
        _source_lang: &str,
        target_lang: &str,
    ) -> anyhow::Result<String> {
        anyhow::ensure!(raw.len() <= MAX_INPUT_BYTES, "翻译输入超过 1 MiB 上限");
        let input = serde_json::json!({ "raw": raw, "targetLang": target_lang }).to_string();
        let mut plugin = self.plugin.lock().await;
        let output: Vec<u8> = plugin
            .call("translate", input.as_bytes())
            .context("plugin translate call failed")?;
        anyhow::ensure!(output.len() <= MAX_OUTPUT_BYTES, "plugin output is too large");
        let value: serde_json::Value = serde_json::from_slice(&output)?;
        let result = value
            .get("result")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("plugin returned no 'result' field"))?;
        Ok(result.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::path::PathBuf;
    use zip::write::SimpleFileOptions;
    use zip::ZipWriter;

    /// Temp dir that cleans itself up even when a test panics.
    struct TempDir(PathBuf);

    impl TempDir {
        fn new(tag: &str) -> Self {
            let unique = format!(
                "scholarust-plugin-host-test-{tag}-{}-{}",
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

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn write_zip(path: &Path, files: &[(&str, &[u8])]) {
        let file = std::fs::File::create(path).unwrap();
        let mut writer = ZipWriter::new(file);
        let options = SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        for (name, bytes) in files {
            writer.start_file(*name, options).unwrap();
            writer.write_all(bytes).unwrap();
        }
        writer.finish().unwrap();
    }

    #[test]
    fn manifest_enabled_defaults_to_true() {
        let manifest: PluginManifest = serde_json::from_str(
            r#"{"name":"示例","version":"0.1.0","entry":"x.wasm"}"#,
        )
        .unwrap();
        assert!(manifest.enabled);

        let manifest: PluginManifest = serde_json::from_str(
            r#"{"name":"示例","version":"0.1.0","entry":"x.wasm","enabled":false}"#,
        )
        .unwrap();
        assert!(!manifest.enabled);
    }

    #[test]
    fn validate_name_rules() {
        for bad in ["../evil", "a/b", "a\\b", "", ".hidden", "a..b", "a\0b"] {
            assert!(validate_name(bad).is_err(), "should reject: {bad:?}");
        }
        assert!(validate_name("材料专业英文术语").is_ok());
        assert!(validate_name("my-plugin_2").is_ok());
    }

    #[test]
    fn install_zip_without_manifest_fails() {
        let tmp = TempDir::new("no-manifest");
        let zip_path = tmp.path().join("pkg.zip");
        write_zip(&zip_path, &[("readme.txt", b"not a plugin")]);
        let result = PluginHost::install_zip(&zip_path, &tmp.path().join("plugins"));
        assert!(result.is_err());
    }

    #[test]
    fn install_zip_rejects_traversal_name() {
        let tmp = TempDir::new("bad-name");
        let zip_path = tmp.path().join("pkg.zip");
        let manifest = br#"{"name":"../evil","version":"0.1.0","entry":"x.wasm"}"#;
        write_zip(&zip_path, &[("plugin.json", manifest)]);
        let result = PluginHost::install_zip(&zip_path, &tmp.path().join("plugins"));
        assert!(result.is_err());
    }

    #[test]
    fn install_zip_rejects_traversal_entry() {
        let tmp = TempDir::new("bad-entry");
        let zip_path = tmp.path().join("pkg.zip");
        let manifest = br#"{"name":"ok","version":"0.1.0","entry":"../../evil.wasm"}"#;
        write_zip(&zip_path, &[("plugin.json", manifest)]);
        let result = PluginHost::install_zip(&zip_path, &tmp.path().join("plugins"));
        assert!(result.is_err());
    }

    #[test]
    fn install_zip_rejects_multiple_manifests() {
        let tmp = TempDir::new("multi-manifest");
        let zip_path = tmp.path().join("pkg.zip");
        let manifest = br#"{"name":"ok","version":"0.1.0","entry":"x.wasm"}"#;
        write_zip(
            &zip_path,
            &[("plugin.json", manifest), ("nested/plugin.json", manifest)],
        );
        let result = PluginHost::install_zip(&zip_path, &tmp.path().join("plugins"));
        assert!(result.is_err());
    }

    #[test]
    fn set_enabled_and_uninstall_round_trip() {
        let tmp = TempDir::new("enable-uninstall");
        let plugins_dir = tmp.path().join("plugins");
        let plugin_dir = plugins_dir.join("测试插件");
        std::fs::create_dir_all(&plugin_dir).unwrap();
        std::fs::write(
            plugin_dir.join("plugin.json"),
            r#"{"name":"测试插件","version":"0.1.0","entry":"x.wasm"}"#,
        )
        .unwrap();

        PluginHost::set_enabled(&plugins_dir, "测试插件", false).unwrap();
        let manifest = read_manifest(&plugin_dir).unwrap();
        assert!(!manifest.enabled);

        PluginHost::set_enabled(&plugins_dir, "测试插件", true).unwrap();
        let manifest = read_manifest(&plugin_dir).unwrap();
        assert!(manifest.enabled);

        assert!(PluginHost::set_enabled(&plugins_dir, "../evil", true).is_err());
        assert!(PluginHost::uninstall(&plugins_dir, "../evil").is_err());

        PluginHost::uninstall(&plugins_dir, "测试插件").unwrap();
        assert!(!plugin_dir.exists());
    }

    /// Smallest valid wasm that exports a no-op `translate`, enough to pass
    /// the install-time instantiation probe without a real toolchain build.
    const MINIMAL_WASM: &[u8] = &[
        0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, // magic + version
        0x01, 0x04, 0x01, 0x60, 0x00, 0x00, // type: () -> ()
        0x03, 0x02, 0x01, 0x00, // func 0 : type 0
        0x07, 0x0d, 0x01, 0x09, b't', b'r', b'a', b'n', b's', b'l', b'a', b't', b'e', 0x00,
        0x00, // export "translate" = func 0
        0x0a, 0x04, 0x01, 0x02, 0x00, 0x0b, // code: empty body
    ];

    #[test]
    fn install_zip_extracts_readme() {
        let tmp = TempDir::new("readme");
        let zip_path = tmp.path().join("pkg.zip");
        let manifest = r#"{"name":"带说明插件","version":"0.1.0","entry":"x.wasm"}"#.as_bytes();
        let readme = "# 插件说明\n这是 README。";
        write_zip(
            &zip_path,
            &[
                ("plugin.json", manifest),
                ("x.wasm", MINIMAL_WASM),
                ("README.md", readme.as_bytes()),
            ],
        );
        let plugins_dir = tmp.path().join("plugins");
        let info = PluginHost::install_zip(&zip_path, &plugins_dir).unwrap();
        assert_eq!(info.name, "带说明插件");
        assert_eq!(
            PluginHost::read_readme(&plugins_dir, "带说明插件").unwrap(),
            readme
        );
    }

    #[test]
    fn install_zip_without_readme_returns_empty() {
        let tmp = TempDir::new("no-readme");
        let zip_path = tmp.path().join("pkg.zip");
        let manifest = r#"{"name":"无说明插件","version":"0.1.0","entry":"x.wasm"}"#.as_bytes();
        write_zip(
            &zip_path,
            &[("plugin.json", manifest), ("x.wasm", MINIMAL_WASM)],
        );
        let plugins_dir = tmp.path().join("plugins");
        PluginHost::install_zip(&zip_path, &plugins_dir).unwrap();
        assert_eq!(
            PluginHost::read_readme(&plugins_dir, "无说明插件").unwrap(),
            ""
        );
    }

    const EMPTY_WASM: &[u8] = &[
        0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, // magic + version
    ];
    const EXTRACT_WASM: &[u8] = &[
        0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, // magic + version
        0x01, 0x04, 0x01, 0x60, 0x00, 0x00, // type: () -> ()
        0x03, 0x02, 0x01, 0x00, // func 0 : type 0
        0x07, 0x0b, 0x01, 0x07, b'e', b'x', b't', b'r', b'a', b'c', b't', 0x00, 0x00,
        0x0a, 0x04, 0x01, 0x02, 0x00, 0x0b, // code: empty body
    ];

    #[test]
    fn legacy_manifest_keeps_working_with_defaults() {
        let manifest: PluginManifest = serde_json::from_str(
            r#"{"name":"旧插件","version":"0.1.0","entry":"x.wasm"}"#,
        )
        .unwrap();
        validate_manifest(&manifest).unwrap();
        assert_eq!(manifest.api_version, 1);
        assert_eq!(manifest.kind, PluginKind::Translate);
        assert!(manifest.permissions.http.is_empty());
        assert!(manifest.contributes.panels.is_empty());
    }

    #[test]
    fn manifest_v2_parses_permissions_and_declarative_panels() {
        let manifest: PluginManifest = serde_json::from_str(
            r#"{
                "name":"术语面板","version":"1.0.0","entry":"x.wasm","apiVersion":2,"kind":"panel",
                "permissions":{"docRead":true,"storage":true,"http":["api.example.com"]},
                "contributes":{"panels":[{
                    "id":"about","title":"关于",
                    "sections":[
                        {"type":"paragraph","text":"说明"},
                        {"type":"list","items":["A","B"]},
                        {"type":"keyValue","items":[{"key":"版本","value":"1.0"}]}
                    ]
                }]}
            }"#,
        )
        .unwrap();
        validate_manifest(&manifest).unwrap();
        assert_eq!(manifest.kind, PluginKind::Panel);
        assert!(manifest.permissions.doc_read);
        assert_eq!(manifest.permissions.http, vec!["api.example.com"]);
        assert_eq!(manifest.contributes.panels[0].sections.len(), 3);
    }

    #[test]
    fn info_serializes_the_v2_contract_for_the_frontend() {
        let manifest: PluginManifest = serde_json::from_str(
            r#"{
                "name":"面板","version":"1.0.0","entry":"x.wasm","apiVersion":2,"kind":"panel",
                "permissions":{"docRead":true,"storage":false,"http":["api.example.com"]},
                "contributes":{"panels":[{"id":"about","title":"关于","sections":[{"type":"paragraph","text":"hi"}]}]}
            }"#,
        )
        .unwrap();
        let json = serde_json::to_value(PluginInfo::from_manifest(&manifest)).unwrap();
        assert_eq!(json["apiVersion"], 2);
        assert_eq!(json["kind"], "panel");
        assert_eq!(json["permissions"]["docRead"], true);
        assert_eq!(json["permissions"]["http"][0], "api.example.com");
        assert_eq!(json["contributes"]["panels"][0]["sections"][0]["type"], "paragraph");

        let doc = DocSnapshot {
            title: "Paper".into(),
            blocks: vec![DocBlock { id: 1, kind: "paragraph".into(), text: "text".into() }],
        };
        let json = serde_json::to_value(doc).unwrap();
        assert_eq!(json["blocks"][0]["kind"], "paragraph");
    }

    #[test]
    fn manifest_validation_rejects_unsupported_versions_kinds_and_hosts() {
        let base = |extra: &str| -> PluginManifest {
            serde_json::from_str(&format!(
                r#"{{"name":"校验","version":"0.1.0","entry":"x.wasm"{extra}}}"#
            ))
            .unwrap()
        };
        assert!(validate_manifest(&base(r#","apiVersion":3"#)).is_err());
        assert!(validate_manifest(&base(r#","apiVersion":0"#)).is_err());
        assert!(validate_manifest(&base(r#","kind":"theme""#)).is_err());
        for host in ["*", "localhost", "127.0.0.1", "10.0.0.8", "192.168.1.2", "172.16.3.4"] {
            let manifest = base(&format!(
                r#","permissions":{{"http":["{host}"]}}"#
            ));
            assert!(validate_manifest(&manifest).is_err(), "should reject {host}");
        }
        let manifest = base(r#","kind":"panel""#);
        assert!(validate_manifest(&manifest).is_err(), "panel needs content");
    }

    #[test]
    fn panel_plugin_installs_without_a_translate_export() {
        let tmp = TempDir::new("panel-install");
        let zip_path = tmp.path().join("pkg.zip");
        let manifest = r#"{
            "name":"面板插件","version":"0.1.0","entry":"x.wasm","apiVersion":2,"kind":"panel",
            "contributes":{"panels":[{"id":"about","title":"关于","sections":[{"type":"paragraph","text":"hi"}]}]}
        }"#;
        write_zip(
            &zip_path,
            &[("plugin.json", manifest.as_bytes()), ("x.wasm", EMPTY_WASM)],
        );
        let plugins_dir = tmp.path().join("plugins");
        let info = PluginHost::install_zip(&zip_path, &plugins_dir).unwrap();
        assert_eq!(info.kind, PluginKind::Panel);
        let loaded =
            PluginHost::load_plugin(&plugins_dir.join("面板插件"), empty_doc_context()).unwrap();
        assert_eq!(loaded.info.contributes.panels.len(), 1);
        assert!(loaded.service.is_none());
        assert!(loaded.parser.is_none());
    }

    #[test]
    fn translate_plugin_still_requires_the_translate_export() {
        let tmp = TempDir::new("translate-export");
        let zip_path = tmp.path().join("pkg.zip");
        let manifest = r#"{"name":"无导出","version":"0.1.0","entry":"x.wasm"}"#;
        write_zip(
            &zip_path,
            &[("plugin.json", manifest.as_bytes()), ("x.wasm", EMPTY_WASM)],
        );
        let error = PluginHost::install_zip(&zip_path, &tmp.path().join("plugins")).unwrap_err();
        assert!(error.to_string().contains("translate"));
    }

    #[test]
    fn bundled_example_plugin_still_installs_and_registers_translate() {
        let zip = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../plugins/example-translate.zip");
        assert!(zip.is_file(), "bundled example plugin is missing: {}", zip.display());
        let tmp = TempDir::new("bundled-example");
        let plugins_dir = tmp.path().join("plugins");
        let info = PluginHost::install_zip(&zip, &plugins_dir).unwrap();
        assert_eq!(info.kind, PluginKind::Translate);
        let loaded =
            PluginHost::load_plugin(&plugins_dir.join(&info.name), empty_doc_context()).unwrap();
        assert!(loaded.service.is_some(), "legacy translate plugin must keep working");
        assert!(loaded.parser.is_none());
    }

    #[tokio::test]
    async fn bundled_example_plugin_still_translates_under_the_new_limits() {
        let zip = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../plugins/example-translate.zip");
        let tmp = TempDir::new("bundled-translate");
        let plugins_dir = tmp.path().join("plugins");
        let info = PluginHost::install_zip(&zip, &plugins_dir).unwrap();
        let loaded =
            PluginHost::load_plugin(&plugins_dir.join(&info.name), empty_doc_context()).unwrap();
        let service = loaded.service.unwrap();
        let result = service
            .translate("The annealing process refines the grain structure.", "en", "zh-CN")
            .await
            .unwrap();
        assert!(result.contains("退火"), "unexpected translation: {result}");
    }

    fn parser_manifest(extensions: &[&str]) -> String {
        let list = extensions
            .iter()
            .map(|ext| format!("\"{ext}\""))
            .collect::<Vec<_>>()
            .join(",");
        format!(
            r#"{{"name":"自定义解析","version":"0.1.0","entry":"x.wasm","apiVersion":2,"kind":"parser",
                "contributes":{{"parsers":[{{"id":"custom","label":"自定义格式","extensions":[{list}]}}]}}}}"#
        )
    }

    #[test]
    fn parser_manifest_rejects_builtin_and_duplicate_extensions() {
        for extensions in [vec!["pdf"], vec!["foo", "FOO"], vec!["a.b"]] {
            let manifest: PluginManifest =
                serde_json::from_str(&parser_manifest(&extensions)).unwrap();
            assert!(
                validate_manifest(&manifest).is_err(),
                "should reject {extensions:?}"
            );
        }
        let manifest: PluginManifest = serde_json::from_str(&parser_manifest(&["foo", "bar"])).unwrap();
        validate_manifest(&manifest).unwrap();
    }

    #[test]
    fn parser_plugin_installs_with_extract_export_and_keeps_claims() {
        let tmp = TempDir::new("parser-install");
        let zip_path = tmp.path().join("pkg.zip");
        write_zip(
            &zip_path,
            &[
                ("plugin.json", parser_manifest(&["foo"]).as_bytes()),
                ("x.wasm", EXTRACT_WASM),
            ],
        );
        let plugins_dir = tmp.path().join("plugins");
        let info = PluginHost::install_zip(&zip_path, &plugins_dir).unwrap();
        assert_eq!(info.kind, PluginKind::Parser);
        assert_eq!(info.contributes.parsers[0].extensions, vec!["foo"]);
        let loaded = PluginHost::load_plugin(&plugins_dir.join(&info.name), empty_doc_context()).unwrap();
        let parser = loaded.parser.expect("parser must be loaded");
        assert!(loaded.service.is_none());
        assert!(parser.claims_extension("foo"));
        assert!(parser.claims_extension("FOO"));
        assert!(!parser.claims_extension("bar"));
    }

    #[test]
    fn parser_plugin_without_extract_is_rejected() {
        let tmp = TempDir::new("parser-no-extract");
        let zip_path = tmp.path().join("pkg.zip");
        write_zip(
            &zip_path,
            &[
                ("plugin.json", parser_manifest(&["foo"]).as_bytes()),
                ("x.wasm", EMPTY_WASM),
            ],
        );
        let error = PluginHost::install_zip(&zip_path, &tmp.path().join("plugins")).unwrap_err();
        assert!(error.to_string().contains("extract"));
    }

    #[tokio::test]
    async fn parser_parses_a_file_end_to_end() {
        let json = r#"{"title":"Foo","blocks":[{"kind":"heading","text":"Intro","level":1},{"kind":"paragraph","text":"Body"}]}"#;
        let stores: String = json
            .bytes()
            .enumerate()
            .map(|(i, byte)| {
                format!("(call $store_u8 (i64.add (local.get $p) (i64.const {i})) (i32.const {byte}))")
            })
            .collect();
        let source = format!(
            r#"(module
                (import "extism:host/env" "alloc" (func $alloc (param i64) (result i64)))
                (import "extism:host/env" "store_u8" (func $store_u8 (param i64 i32)))
                (import "extism:host/env" "output_set" (func $output_set (param i64 i64)))
                (func (export "extract")
                    (local $p i64)
                    (local.set $p (call $alloc (i64.const {len})))
                    {stores}
                    (call $output_set (local.get $p) (i64.const {len}))
                )
            )"#,
            len = json.len()
        );
        let wasm = wat::parse_str(source).unwrap();
        let tmp = TempDir::new("parser-e2e");
        let zip_path = tmp.path().join("pkg.zip");
        write_zip(
            &zip_path,
            &[
                ("plugin.json", parser_manifest(&["foo"]).as_bytes()),
                ("x.wasm", &wasm),
            ],
        );
        let plugins_dir = tmp.path().join("plugins");
        let info = PluginHost::install_zip(&zip_path, &plugins_dir).unwrap();
        let loaded = PluginHost::load_plugin(&plugins_dir.join(&info.name), empty_doc_context()).unwrap();
        let parser = loaded.parser.unwrap();
        let file = tmp.path().join("sample.foo");
        std::fs::write(&file, b"raw bytes").unwrap();
        let parsed = parser.parse(&file, "foo").await.unwrap();
        assert_eq!(parsed.title.as_deref(), Some("Foo"));
        assert_eq!(parsed.blocks.len(), 2);
        assert_eq!(parsed.blocks[0].kind, "heading");
        assert_eq!(parsed.blocks[1].text, "Body");
    }

    #[test]
    fn parser_output_contract_validates_kinds_text_and_defaults() {
        let output = br#"{
            "title":"Paper","notice":"n",
            "blocks":[
                {"kind":"heading","text":"Intro","level":1},
                {"text":"plain"},
                {"kind":"figure","text":"bad"}
            ]
        }"#;
        assert!(parsed_from_output(output).is_err(), "figure is not representable");

        let output = br#"{"blocks":[{"kind":"heading","text":"Intro","level":9},{"text":"plain"}]}"#;
        let parsed = parsed_from_output(output).unwrap();
        assert_eq!(parsed.blocks.len(), 2);
        assert_eq!(parsed.blocks[0].kind, "heading");
        assert_eq!(parsed.blocks[0].level, 6);
        assert_eq!(parsed.blocks[1].kind, "paragraph");
        assert_eq!(parsed.blocks[1].id, 1);
        assert!(parsed_from_output(br#"{"blocks":[]}"#).is_ok());
        assert!(parsed_from_output(b"not json").is_err());
    }

    #[test]
    fn read_readme_missing_plugin_and_traversal() {
        let tmp = TempDir::new("readme-guard");
        assert_eq!(
            PluginHost::read_readme(tmp.path(), "不存在的插件").unwrap(),
            ""
        );
        assert!(PluginHost::read_readme(tmp.path(), "../evil").is_err());
    }

    fn json_returning_wasm(export: &str, json: &str) -> Vec<u8> {
        let stores: String = json
            .bytes()
            .enumerate()
            .map(|(i, byte)| {
                format!("(call $store_u8 (i64.add (local.get $p) (i64.const {i})) (i32.const {byte}))")
            })
            .collect();
        wat::parse_str(format!(
            r#"(module
                (import "extism:host/env" "alloc" (func $alloc (param i64) (result i64)))
                (import "extism:host/env" "store_u8" (func $store_u8 (param i64 i32)))
                (import "extism:host/env" "output_set" (func $output_set (param i64 i64)))
                (func (export "{export}")
                    (local $p i64)
                    (local.set $p (call $alloc (i64.const {len})))
                    {stores}
                    (call $output_set (local.get $p) (i64.const {len}))
                )
            )"#,
            len = json.len()
        ))
        .unwrap()
    }

    fn parser_manifest_named(name: &str, version: &str, extensions: &[&str]) -> String {
        let list = extensions
            .iter()
            .map(|ext| format!("\"{ext}\""))
            .collect::<Vec<_>>()
            .join(",");
        format!(
            r#"{{"name":"{name}","version":"{version}","entry":"x.wasm","apiVersion":2,"kind":"parser",
                "contributes":{{"parsers":[{{"id":"custom","extensions":[{list}]}}]}}}}"#
        )
    }

    #[test]
    fn parser_magic_signatures_are_validated_and_matched() {
        let manifest: PluginManifest = serde_json::from_str(
            r#"{"name":"魔数解析","version":"1.0.0","entry":"x.wasm","apiVersion":2,"kind":"parser",
                "contributes":{"parsers":[{"id":"magic","extensions":["foo"],"magic":["0a0b","ff"]}]}}"#,
        )
        .unwrap();
        validate_manifest(&manifest).unwrap();
        assert!(claims_magic(&manifest.contributes.parsers, &[0x0a, 0x0b, 0x01]));
        assert!(!claims_magic(&manifest.contributes.parsers, &[0x0a, 0x0c]));

        for bad in ["0", "xyz", "0a0"] {
            let manifest: PluginManifest = serde_json::from_str(&format!(
                r#"{{"name":"魔数解析","version":"1.0.0","entry":"x.wasm","kind":"parser",
                    "contributes":{{"parsers":[{{"id":"magic","extensions":["foo"],"magic":["{bad}"]}}]}}}}"#
            ))
            .unwrap();
            assert!(validate_manifest(&manifest).is_err(), "should reject {bad:?}");
        }
    }

    #[test]
    fn parser_output_accepts_figures_and_rejects_non_data_urls() {
        let image = "data:image/png;base64,iVBORw0KGgo=";
        let parsed = parsed_from_output(
            format!(r#"{{"blocks":[{{"kind":"figure","text":"图 1","image":"{image}"}}]}}"#).as_bytes(),
        )
        .unwrap();
        assert_eq!(parsed.blocks[0].kind, "figure");
        assert_eq!(parsed.blocks[0].image.as_deref(), Some(image));

        assert!(parsed_from_output(br#"{"blocks":[{"kind":"figure","text":"x"}]}"#).is_err());
        assert!(parsed_from_output(
            br#"{"blocks":[{"kind":"figure","text":"x","image":"https://example.com/a.png"}]}"#
        )
        .is_err());
        assert!(parsed_from_output(
            br#"{"blocks":[{"kind":"paragraph","text":"x","image":"data:image/png;base64,AA=="}]}"#
        )
        .is_err());
        assert!(parsed_from_output(
            br#"{"blocks":[{"kind":"figure","text":"x","image":"data:image/png;base64,@@@"}]}"#
        )
        .is_err());
    }

    #[test]
    fn preview_reports_versions_digest_and_extension_conflicts() {
        let tmp = TempDir::new("preview");
        let plugins_dir = tmp.path().join("plugins");
        let first = tmp.path().join("first.zip");
        write_zip(
            &first,
            &[
                ("plugin.json", parser_manifest_named("解析甲", "1.0.0", &["foo"]).as_bytes()),
                ("x.wasm", EXTRACT_WASM),
            ],
        );
        PluginHost::install_zip(&first, &plugins_dir).unwrap();

        let conflicting = tmp.path().join("conflicting.zip");
        write_zip(
            &conflicting,
            &[
                ("plugin.json", parser_manifest_named("解析乙", "1.0.0", &["foo"]).as_bytes()),
                ("x.wasm", EXTRACT_WASM),
            ],
        );
        let preview = PluginHost::inspect_zip(&conflicting, &plugins_dir).unwrap();
        assert_eq!(preview.version_change, VersionChange::New);
        assert!(preview.installed.is_none());
        assert_eq!(preview.conflicts.len(), 1);
        assert_eq!(preview.conflicts[0].extension, "foo");
        assert_eq!(preview.conflicts[0].plugin, "解析甲");
        assert_eq!(preview.digest.len(), 64);
        assert!(PluginHost::install_zip(&conflicting, &plugins_dir).is_err());

        let upgrade = tmp.path().join("upgrade.zip");
        write_zip(
            &upgrade,
            &[
                ("plugin.json", parser_manifest_named("解析甲", "2.0.0", &["foo"]).as_bytes()),
                ("x.wasm", EXTRACT_WASM),
            ],
        );
        let preview = PluginHost::inspect_zip(&upgrade, &plugins_dir).unwrap();
        assert_eq!(preview.version_change, VersionChange::Upgrade);
        assert!(preview.conflicts.is_empty());
        assert!(preview.installed.is_some());
    }

    #[test]
    fn startup_skips_a_parser_whose_extension_is_already_claimed() {
        let tmp = TempDir::new("startup-conflict");
        let plugins_dir = tmp.path().join("plugins");
        for name in ["解析甲", "解析乙"] {
            let dir = plugins_dir.join(name);
            std::fs::create_dir_all(&dir).unwrap();
            std::fs::write(
                dir.join("plugin.json"),
                parser_manifest_named(name, "1.0.0", &["foo"]),
            )
            .unwrap();
            std::fs::write(dir.join("x.wasm"), EXTRACT_WASM).unwrap();
        }
        let host = PluginHost::load_dir(&plugins_dir);
        assert_eq!(host.parsers.len(), 1);
        let conflicted = host
            .plugins
            .iter()
            .filter(|info| info.conflict.is_some())
            .count();
        assert_eq!(conflicted, 1);
        assert!(host.plugins.iter().any(|info| info.conflict.as_deref().is_some_and(|msg| msg.contains("foo"))));
    }

    #[tokio::test]
    async fn dynamic_panel_is_served_through_the_panel_export() {
        let tmp = TempDir::new("dynamic-panel");
        let manifest = r#"{"name":"动态面板","version":"1.0.0","entry":"x.wasm","apiVersion":2,
            "kind":"panel","permissions":{"storage":true},
            "contributes":{"panels":[{"id":"stats","title":"统计","dynamic":true}]}}"#;
        let wasm = json_returning_wasm(
            "panel",
            r#"{"sections":[{"type":"paragraph","text":"实时内容"},{"type":"keyValue","items":[{"key":"计数","value":"2"}]}]}"#,
        );
        let zip_path = tmp.path().join("pkg.zip");
        write_zip(
            &zip_path,
            &[("plugin.json", manifest.as_bytes()), ("x.wasm", &wasm)],
        );
        let plugins_dir = tmp.path().join("plugins");
        PluginHost::install_zip(&zip_path, &plugins_dir).unwrap();
        let loaded =
            PluginHost::load_plugin(&plugins_dir.join("动态面板"), empty_doc_context()).unwrap();
        let panel = loaded.panel.expect("dynamic panel runtime");
        assert!(panel.has_panel("stats"));
        let sections = panel.sections("stats").await.unwrap();
        assert_eq!(sections.len(), 2);
        assert!(panel.sections("missing").await.is_err());

        let missing_export = r#"{"name":"缺导出","version":"1.0.0","entry":"x.wasm","apiVersion":2,
            "kind":"panel","contributes":{"panels":[{"id":"stats","title":"统计","dynamic":true}]}}"#;
        let zip_path = tmp.path().join("missing.zip");
        write_zip(
            &zip_path,
            &[
                ("plugin.json", missing_export.as_bytes()),
                ("x.wasm", EMPTY_WASM),
            ],
        );
        let error = PluginHost::install_zip(&zip_path, &tmp.path().join("plugins2")).unwrap_err();
        assert!(error.to_string().contains("panel"));
    }
}