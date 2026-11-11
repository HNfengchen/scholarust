use anyhow::{Context, Result};
use ort::session::Session;
use ort::value::{Shape, Tensor};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::time::SystemTime;
use std::sync::{Mutex, OnceLock};

const INPUT_SIZE: usize = 1024;
const PAD_VALUE: f32 = 114.0 / 255.0;
const CONF_THRESHOLD: f32 = 0.3;

/// A layout region in original image pixel coordinates (top-left origin).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Detection {
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
    pub confidence: f32,
    pub class_id: u32,
}

static ENV: OnceLock<ort::environment::Environment> = OnceLock::new();
static SESSION: Mutex<Option<(PathBuf, SystemTime, Session)>> = Mutex::new(None);

fn ensure_env() -> Result<&'static ort::environment::Environment> {
    if let Some(env) = ENV.get() {
        return Ok(env);
    }
    let env = ort::init()
        .with_name("scholarust-layout")
        .build()
        .context("初始化 ONNX Runtime 环境失败")?;
    let _ = ENV.set(env);
    Ok(ENV.get().unwrap())
}

fn preprocess(png: &[u8]) -> Result<(Vec<f32>, f32, usize, usize, u32, u32)> {
    anyhow::ensure!(png.len() <= 8 * 1024 * 1024, "版面图像过大");
    let mut reader = image::ImageReader::with_format(std::io::Cursor::new(png), image::ImageFormat::Png);
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(4096);
    limits.max_image_height = Some(4096);
    reader.limits(limits);
    let img = reader.decode().context("解码版面渲染图失败")?.to_rgb8();
    let (w, h) = img.dimensions();
    anyhow::ensure!(w > 0 && h > 0, "版面渲染图为空");
    let scale = (INPUT_SIZE as f32 / w as f32).min(INPUT_SIZE as f32 / h as f32);
    let new_w = ((w as f32 * scale).round() as u32).max(1);
    let new_h = ((h as f32 * scale).round() as u32).max(1);
    let resized = if (w, h) == (new_w, new_h) {
        img
    } else {
        image::imageops::resize(&img, new_w, new_h, image::imageops::FilterType::Triangle)
    };
    let pad_x = (INPUT_SIZE - new_w as usize) / 2;
    let pad_y = (INPUT_SIZE - new_h as usize) / 2;

    let plane = INPUT_SIZE * INPUT_SIZE;
    let mut data = vec![PAD_VALUE; 3 * plane];
    for y in 0..new_h as usize {
        for x in 0..new_w as usize {
            let pixel = resized.get_pixel(x as u32, y as u32);
            let dx = x + pad_x;
            let dy = y + pad_y;
            let offset = dy * INPUT_SIZE + dx;
            for c in 0..3 {
                data[c * plane + offset] = pixel[c] as f32 / 255.0;
            }
        }
    }
    Ok((data, scale, pad_x, pad_y, w, h))
}

fn parse_output(
    raw: &[f32],
    scale: f32,
    pad_x: usize,
    pad_y: usize,
    w: u32,
    h: u32,
) -> Vec<Detection> {
    let mut detections = Vec::new();
    let rows = raw.len() / 6;
    for i in 0..rows {
        let base = i * 6;
        let confidence = raw[base + 4];
        if confidence < CONF_THRESHOLD || !raw[base..base + 6].iter().all(|v| v.is_finite())
            || !(0.0..=9.0).contains(&raw[base + 5]) {
            continue;
        }
        let x1 = (raw[base] - pad_x as f32) / scale;
        let y1 = (raw[base + 1] - pad_y as f32) / scale;
        let x2 = (raw[base + 2] - pad_x as f32) / scale;
        let y2 = (raw[base + 3] - pad_y as f32) / scale;
        let x1 = x1.clamp(0.0, w as f32);
        let y1 = y1.clamp(0.0, h as f32);
        let x2 = x2.clamp(0.0, w as f32);
        let y2 = y2.clamp(0.0, h as f32);
        if x2 <= x1 || y2 <= y1 {
            continue;
        }
        detections.push(Detection {
            x: x1,
            y: y1,
            w: x2 - x1,
            h: y2 - y1,
            confidence,
            class_id: raw[base + 5].round().max(0.0) as u32,
        });
    }
    detections.sort_by(|a, b| b.confidence.total_cmp(&a.confidence));
    detections
}

pub fn detect_layout(model_path: &Path, png: &[u8]) -> Result<Vec<Detection>> {
    anyhow::ensure!(model_path.is_file(), "未找到版面模型: {}", model_path.display());
    let (data, scale, pad_x, pad_y, w, h) = preprocess(png)?;

    let modified = model_path.metadata()?.modified()?;
    let mut guard = SESSION.lock().map_err(|_| anyhow::anyhow!("版面会话不可用"))?;
    if guard.as_ref().is_none_or(|(path, time, _)| path != model_path || *time != modified) {
        let env = ensure_env()?;
        let builder = Session::builder(env)
            .context("创建 ONNX 会话失败")?
            .with_intra_threads(4)
            .map_err(|e| anyhow::anyhow!("设置推理线程失败: {e}"))?;
        #[cfg(windows)]
        let builder = builder
            .with_memory_pattern(false)
            .map_err(|e| anyhow::anyhow!("设置 GPU 内存失败: {e}"))?
            .with_execution_providers([
                ort::ep::DirectML::default()
                    .with_performance_preference(ort::ep::directml::PerformancePreference::HighPerformance)
                    .build(),
            ])
            .map_err(|e| anyhow::anyhow!("设置推理设备失败: {e}"))?;
        let mut builder = builder;
        let session = builder
            .commit_from_file(model_path)
            .with_context(|| format!("加载版面模型失败: {}", model_path.display()))?;
        *guard = Some((model_path.to_path_buf(), modified, session));
    }
    let session = &mut guard.as_mut().unwrap().2;

    let tensor = Tensor::<f32>::from_array((
        Shape::new([1i64, 3, INPUT_SIZE as i64, INPUT_SIZE as i64]),
        data,
    ))
    .context("构造输入张量失败")?;
    let outputs = session
        .run(ort::inputs![tensor])
        .context("版面推理失败")?;
    let output = outputs.get("output0").context("模型缺少 output0 输出")?;
    let (shape, raw) = output.try_extract_tensor::<f32>().context("读取版面输出失败")?;
    anyhow::ensure!(shape.len() == 3 && shape[0] == 1 && shape[2] == 6, "版面模型输出应为 [1, N, 6]");
    Ok(parse_output(raw, scale, pad_x, pad_y, w, h))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_letterboxed_coordinates_and_discards_invalid_rows() {
        let raw = [
            120.0, 40.0, 520.0, 240.0, 0.9, 5.0,
            120.0, 40.0, 520.0, 240.0, 0.1, 3.0,
            f32::NAN, 40.0, 520.0, 240.0, 0.9, 1.0,
        ];
        let detections = parse_output(&raw, 2.0, 100, 0, 300, 500);
        assert_eq!(detections.len(), 1);
        assert_eq!(detections[0].class_id, 5);
        assert_eq!((detections[0].x, detections[0].y, detections[0].w, detections[0].h), (10.0, 20.0, 200.0, 100.0));
    }

    #[test]
    fn rejects_non_image_input() {
        assert!(preprocess(b"not a png").is_err());
    }

    #[test]
    fn pads_rgb_input_in_chw_order() {
        let image = image::RgbImage::from_pixel(512, 1024, image::Rgb([255, 0, 128]));
        let mut png = std::io::Cursor::new(Vec::new());
        image.write_to(&mut png, image::ImageFormat::Png).unwrap();
        let (data, scale, x, y, w, h) = preprocess(png.get_ref()).unwrap();
        assert_eq!((scale, x, y, w, h), (1.0, 256, 0, 512, 1024));
        assert_eq!(data[0], PAD_VALUE);
        assert_eq!(data[256], 1.0);
        assert_eq!(data[INPUT_SIZE * INPUT_SIZE + 256], 0.0);
    }
}
