use base64::{engine::general_purpose::STANDARD, Engine as _};
use extism_pdk::*;
use serde_json::{json, Value};

#[host_fn]
extern "ExtismHost" {
    fn sr_file_read(request: String) -> String;
}

/// The host embeds one figure image only when its base64 form stays under
/// 2 MiB, so the raw file must stay below roughly 1.5 MiB.
const MAX_RAW_BYTES: u64 = 1_500_000;

fn read_all() -> FnResult<Vec<u8>> {
    let mut bytes = Vec::new();
    let mut offset = 0u64;
    loop {
        let raw = unsafe { sr_file_read(json!({ "offset": offset, "limit": 65536 }).to_string()) }?;
        let page: Value = serde_json::from_str(&raw)?;
        let chunk = STANDARD
            .decode(page["data"].as_str().unwrap_or(""))
            .map_err(|err| Error::msg(err.to_string()))?;
        if chunk.is_empty() {
            break;
        }
        offset += chunk.len() as u64;
        bytes.extend_from_slice(&chunk);
        let eof = page["eof"].as_bool().unwrap_or(true);
        if eof || bytes.len() as u64 >= MAX_RAW_BYTES {
            break;
        }
    }
    Ok(bytes)
}

fn mime_for(extension: &str) -> &'static str {
    match extension {
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "gif" => "image/gif",
        "tif" | "tiff" => "image/tiff",
        _ => "image/png",
    }
}

fn title_of(name: &str) -> String {
    name.rsplit_once('.')
        .map(|(stem, _)| stem)
        .unwrap_or(name)
        .trim()
        .to_string()
}

#[plugin_fn]
pub fn extract(input: String) -> FnResult<String> {
    let request: Value = serde_json::from_str(&input)?;
    let name = request["name"].as_str().unwrap_or("图片").to_string();
    let extension = request["extension"]
        .as_str()
        .unwrap_or("png")
        .to_ascii_lowercase();
    let size = request["size"].as_u64().unwrap_or(0);
    let title = title_of(&name);

    if size > MAX_RAW_BYTES {
        return Ok(json!({
            "title": title,
            "notice": "图片超过约 1.5MB，无法完整内嵌到视图中；请压缩后再导入。",
            "blocks": [{ "kind": "paragraph", "text": name, "level": 0 }]
        })
        .to_string());
    }

    let bytes = read_all()?;
    if bytes.is_empty() {
        return Ok(json!({
            "title": title,
            "notice": "图片文件为空。",
            "blocks": []
        })
        .to_string());
    }

    let payload = STANDARD.encode(&bytes);
    Ok(json!({
        "title": title,
        "blocks": [{
            "kind": "figure",
            "text": name,
            "level": 0,
            "image": format!("data:{};base64,{}", mime_for(&extension), payload)
        }]
    })
    .to_string())
}