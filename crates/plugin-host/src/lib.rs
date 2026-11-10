use anyhow::Context;
use async_trait::async_trait;
use scholarust_translate::TranslateService;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::Read;
use std::path::Path;
use std::sync::Arc;
use tokio::sync::Mutex;
use zip::ZipArchive;

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
}

fn default_enabled() -> bool {
    true
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginInfo {
    pub name: String,
    pub version: String,
    pub description: String,
    pub enabled: bool,
}

impl PluginInfo {
    fn from_manifest(manifest: &PluginManifest) -> Self {
        Self {
            name: manifest.name.clone(),
            version: manifest.version.clone(),
            description: manifest.description.clone(),
            enabled: manifest.enabled,
        }
    }
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

/// Loads WASM plugins (Extism runtime). Each plugin may export a
/// `translate` function: JSON in {"raw","targetLang"} -> JSON out {"result"},
/// which is registered as an extra translation service — the same extension
/// direction as zotero-pdf-translate's service modules, but sandboxed.
pub struct PluginHost {
    pub plugins: Vec<PluginInfo>,
    pub services: Vec<Arc<dyn TranslateService>>,
}

impl PluginHost {
    pub fn load_dir(dir: &Path) -> Self {
        let mut host = Self {
            plugins: Vec::new(),
            services: Vec::new(),
        };
        let Ok(entries) = std::fs::read_dir(dir) else {
            return host;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            match Self::load_one(&path) {
                Ok((info, service)) => {
                    if let Some(service) = service {
                        host.services.push(service);
                    }
                    host.plugins.push(info);
                }
                Err(err) => {
                    eprintln!("failed to load plugin {}: {err}", path.display());
                }
            }
        }
        host
    }

    /// Loads a plugin directory. Disabled plugins yield info only (no
    /// service); enabled plugins yield info plus a live service.
    fn load_one(dir: &Path) -> anyhow::Result<(PluginInfo, Option<Arc<dyn TranslateService>>)> {
        let manifest = read_manifest(dir)?;
        let info = PluginInfo::from_manifest(&manifest);
        let service = if manifest.enabled {
            Some(instantiate_service(dir, &manifest)?)
        } else {
            None
        };
        Ok((info, service))
    }

    /// Loads the manifest (whatever its `enabled` value) and instantiates the
    /// translation service. Used right after import / enable.
    pub fn load_service(dir: &Path) -> anyhow::Result<(PluginInfo, Arc<dyn TranslateService>)> {
        let manifest = read_manifest(dir)?;
        let info = PluginInfo::from_manifest(&manifest);
        let service = instantiate_service(dir, &manifest)?;
        Ok((info, service))
    }

    /// Installs a plugin from a ZIP package containing `plugin.json` + the
    /// wasm entry, either at the archive root or under a single top-level
    /// folder. The wasm is validated (instantiated + `translate` export
    /// check) before anything is written to disk. Installing over an existing
    /// plugin of the same name upgrades it in place.
    pub fn install_zip(zip_path: &Path, plugins_dir: &Path) -> anyhow::Result<PluginInfo> {
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

        validate_name(&manifest.name)?;
        if manifest.version.trim().is_empty() {
            anyhow::bail!("plugin version must not be empty");
        }
        if manifest.entry.is_empty()
            || manifest.entry.contains("..")
            || manifest.entry.contains('/')
            || manifest.entry.contains('\\')
            || manifest.entry.contains(':')
        {
            anyhow::bail!("invalid wasm entry (must be a plain file name): {}", manifest.entry);
        }

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

        // Validate before touching the plugins directory; drop the probe
        // instance afterwards.
        {
            let probe =
                extism::Plugin::new(&wasm, [], true).context("failed to instantiate wasm")?;
            if !probe.function_exists("translate") {
                anyhow::bail!("plugin does not export a 'translate' function");
            }
        }

        let target = plugins_dir.join(&manifest.name);
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

        Ok(PluginInfo::from_manifest(&manifest))
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

fn instantiate_service(
    dir: &Path,
    manifest: &PluginManifest,
) -> anyhow::Result<Arc<dyn TranslateService>> {
    let wasm = std::fs::read(dir.join(&manifest.entry))
        .with_context(|| format!("missing wasm entry: {}", manifest.entry))?;
    let plugin = extism::Plugin::new(&wasm, [], true).context("failed to instantiate wasm")?;
    if !plugin.function_exists("translate") {
        anyhow::bail!("plugin does not export a 'translate' function");
    }
    Ok(Arc::new(PluginTranslateService {
        id: format!("plugin:{}", manifest.name),
        name: manifest.name.clone(),
        plugin: Arc::new(Mutex::new(plugin)),
    }))
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
        let input = serde_json::json!({ "raw": raw, "targetLang": target_lang }).to_string();
        let mut plugin = self.plugin.lock().await;
        let output: Vec<u8> = plugin
            .call("translate", input.as_bytes())
            .context("plugin translate call failed")?;
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
        assert!(validate_name("术语词条例句").is_ok());
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
}