use serde::{Deserialize, Serialize};
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::Path;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DocumentKind {
    Pdf,
    Epub,
    Docx,
    Markdown,
    Text,
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
}