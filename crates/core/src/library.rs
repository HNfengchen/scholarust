use crate::DocumentInfo;
use serde::{Deserialize, Serialize};
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Collection {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub parent_id: Option<String>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
pub struct Library {
    pub documents: Vec<DocumentInfo>,
    #[serde(default)]
    pub collections: Vec<Collection>,
    #[serde(skip)]
    file: PathBuf,
}

impl Library {
    pub fn load(file: PathBuf) -> Self {
        let mut lib: Library = std::fs::read_to_string(&file)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
        lib.file = file;
        lib
    }

    pub fn save(&self) -> anyhow::Result<()> {
        if let Some(parent) = self.file.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(&self.file, serde_json::to_string_pretty(self)?)?;
        Ok(())
    }

    pub fn add(&mut self, doc: DocumentInfo) -> DocumentInfo {
        if let Some(existing) = self.documents.iter().find(|d| d.id == doc.id) {
            return existing.clone();
        }
        self.documents.push(doc.clone());
        doc
    }

    pub fn remove(&mut self, id: &str) {
        self.documents.retain(|d| d.id != id);
    }

    pub fn get(&self, id: &str) -> Option<&DocumentInfo> {
        self.documents.iter().find(|d| d.id == id)
    }

    pub fn file_path(&self) -> &Path {
        &self.file
    }

    pub fn create_collection(&mut self, name: &str, parent_id: Option<String>) -> Collection {
        let mut hasher = DefaultHasher::new();
        name.hash(&mut hasher);
        self.collections.len().hash(&mut hasher);
        let collection = Collection {
            id: format!("c{:016x}", hasher.finish()),
            name: name.to_string(),
            parent_id,
        };
        self.collections.push(collection.clone());
        collection
    }

    pub fn rename_collection(&mut self, id: &str, name: &str) -> anyhow::Result<()> {
        let collection = self
            .collections
            .iter_mut()
            .find(|c| c.id == id)
            .ok_or_else(|| anyhow::anyhow!("collection not found: {id}"))?;
        collection.name = name.to_string();
        Ok(())
    }

    pub fn delete_collection(&mut self, id: &str) {
        let parent = self
            .collections
            .iter()
            .find(|c| c.id == id)
            .and_then(|c| c.parent_id.clone());
        self.collections.retain(|c| c.id != id);
        for collection in self.collections.iter_mut() {
            if collection.parent_id.as_deref() == Some(id) {
                collection.parent_id = parent.clone();
            }
        }
        for doc in self.documents.iter_mut() {
            doc.collection_ids.retain(|cid| cid != id);
        }
    }

    pub fn update_document_meta(
        &mut self,
        id: &str,
        tags: Option<Vec<String>>,
        collection_ids: Option<Vec<String>>,
    ) -> anyhow::Result<DocumentInfo> {
        let doc = self
            .documents
            .iter_mut()
            .find(|d| d.id == id)
            .ok_or_else(|| anyhow::anyhow!("document not found: {id}"))?;
        if let Some(tags) = tags {
            doc.tags = tags;
        }
        if let Some(collection_ids) = collection_ids {
            doc.collection_ids = collection_ids;
        }
        Ok(doc.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::DocumentKind;

    fn doc(id: &str) -> DocumentInfo {
        DocumentInfo {
            id: id.into(),
            path: format!("/{id}.pdf"),
            title: id.into(),
            kind: DocumentKind::Pdf,
            tags: vec![],
            collection_ids: vec![],
        }
    }

    #[test]
    fn collection_crud_and_reparenting() {
        let mut lib = Library::default();
        let root = lib.create_collection("Root", None);
        let child = lib.create_collection("Child", Some(root.id.clone()));
        assert_eq!(lib.collections.len(), 2);

        lib.rename_collection(&child.id, "Renamed").unwrap();
        assert_eq!(lib.collections[1].name, "Renamed");

        let mut d = doc("d1");
        d.collection_ids.push(child.id.clone());
        lib.add(d);

        lib.delete_collection(&root.id);
        assert_eq!(lib.collections.len(), 1);
        assert!(lib.collections[0].parent_id.is_none());
        assert_eq!(lib.documents[0].collection_ids, vec![child.id.clone()]);

        lib.delete_collection(&child.id);
        assert!(lib.collections.is_empty());
        assert!(lib.documents[0].collection_ids.is_empty());
    }

    #[test]
    fn document_meta_updates() {
        let mut lib = Library::default();
        lib.add(doc("d1"));
        let updated = lib
            .update_document_meta("d1", Some(vec!["ml".into()]), None)
            .unwrap();
        assert_eq!(updated.tags, vec!["ml"]);
        assert!(updated.collection_ids.is_empty());
        assert!(lib.update_document_meta("nope", None, None).is_err());
    }
}