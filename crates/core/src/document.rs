use serde::{Deserialize, Deserializer, Serialize, Serializer};
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::Path;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DocumentKind {
    Pdf,
    Epub,
    Docx,
    Markdown,
    Text,
    /// A format handled by a parser plugin. The string is the lowercase extension.
    Custom(String),
}

impl DocumentKind {
    pub fn from_path(path: &Path) -> Option<Self> {
        let ext = path.extension()?.to_str()?.to_ascii_lowercase();
        Some(match ext.as_str() {
            "pdf" => Self::Pdf,
            "epub" => Self::Epub,
            "docx" => Self::Docx,
            "md" | "markdown" => Self::Markdown,
            "txt" | "text" => Self::Text,
            _ => return None,
        })
    }

    pub fn is_builtin(&self) -> bool {
        !matches!(self, Self::Custom(_))
    }

    pub fn extension(&self) -> Option<&str> {
        match self {
            Self::Custom(ext) => Some(ext),
            _ => None,
        }
    }
}

impl Serialize for DocumentKind {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let text = match self {
            Self::Pdf => "pdf".to_string(),
            Self::Epub => "epub".to_string(),
            Self::Docx => "docx".to_string(),
            Self::Markdown => "markdown".to_string(),
            Self::Text => "text".to_string(),
            Self::Custom(ext) => format!("plugin:{ext}"),
        };
        serializer.serialize_str(&text)
    }
}

impl<'de> Deserialize<'de> for DocumentKind {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let value = String::deserialize(deserializer)?;
        Ok(match value.as_str() {
            "pdf" => Self::Pdf,
            "epub" => Self::Epub,
            "docx" => Self::Docx,
            "markdown" => Self::Markdown,
            "text" => Self::Text,
            other => Self::Custom(
                other
                    .strip_prefix("plugin:")
                    .filter(|ext| !ext.is_empty())
                    .unwrap_or(other)
                    .to_string(),
            ),
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentInfo {
    pub id: String,
    pub path: String,
    pub title: String,
    pub kind: DocumentKind,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub collection_ids: Vec<String>,
}

impl DocumentInfo {
    pub fn from_path(path: &Path) -> anyhow::Result<Self> {
        let kind = DocumentKind::from_path(path)
            .ok_or_else(|| anyhow::anyhow!("unsupported file type: {}", path.display()))?;
        Self::from_path_with_kind(path, kind)
    }

    /// Build a document whose kind is decided by the caller, e.g. a
    /// `DocumentKind::Custom` claimed by an enabled parser plugin.
    pub fn from_path_with_kind(path: &Path, kind: DocumentKind) -> anyhow::Result<Self> {
        if !path.is_file() {
            anyhow::bail!("file not found: {}", path.display());
        }
        let mut hasher = DefaultHasher::new();
        path.to_string_lossy().hash(&mut hasher);
        let id = format!("{:016x}", hasher.finish());
        let title = path
            .file_stem()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_else(|| "Untitled".into());
        Ok(Self {
            id,
            path: path.to_string_lossy().into_owned(),
            title,
            kind,
            tags: Vec::new(),
            collection_ids: Vec::new(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_kinds_by_extension() {
        assert_eq!(DocumentKind::from_path(Path::new("a.PDF")), Some(DocumentKind::Pdf));
        assert_eq!(DocumentKind::from_path(Path::new("a.epub")), Some(DocumentKind::Epub));
        assert_eq!(DocumentKind::from_path(Path::new("a.docx")), Some(DocumentKind::Docx));
        assert_eq!(DocumentKind::from_path(Path::new("a.md")), Some(DocumentKind::Markdown));
        assert_eq!(DocumentKind::from_path(Path::new("a.markdown")), Some(DocumentKind::Markdown));
        assert_eq!(DocumentKind::from_path(Path::new("a.txt")), Some(DocumentKind::Text));
        assert_eq!(DocumentKind::from_path(Path::new("a.exe")), None);
        assert_eq!(DocumentKind::from_path(Path::new("noext")), None);
    }

    #[test]
    fn custom_kinds_round_trip_through_the_plugin_prefix() {
        let kind = DocumentKind::Custom("foo".into());
        let json = serde_json::to_string(&kind).unwrap();
        assert_eq!(json, "\"plugin:foo\"");
        assert_eq!(serde_json::from_str::<DocumentKind>(&json).unwrap(), kind);
        assert_eq!(
            serde_json::from_str::<DocumentKind>("\"pdf\"").unwrap(),
            DocumentKind::Pdf
        );
        assert_eq!(
            serde_json::from_str::<DocumentKind>("\"epub\"").unwrap(),
            DocumentKind::Epub
        );
        assert!(!kind.is_builtin());
        assert_eq!(kind.extension(), Some("foo"));
    }
}