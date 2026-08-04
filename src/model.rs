use std::collections::HashSet;

use serde::{Deserialize, Serialize};
use url::Url;

pub const MAX_MESSAGE_CHARS: usize = 10_000;
pub const MAX_COMMENT_CHARS: usize = 5_000;
pub const MAX_COMMENTS: usize = 100;
pub const MAX_DRAWING_STROKES: usize = 500;
pub const MAX_DRAWING_POINTS: usize = 50_000;
pub const MAX_SCREENSHOT_BYTES: usize = 10 * 1024 * 1024;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackSubmission {
    pub session_id: String,
    pub message: String,
    pub page: PageContext,
    #[serde(default)]
    pub comments: Vec<FeedbackComment>,
    #[serde(default)]
    pub drawings: Vec<DrawingStroke>,
    pub screenshot_data_url: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PageContext {
    pub url: String,
    pub title: String,
    pub viewport: Viewport,
    pub device_pixel_ratio: f64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Viewport {
    pub width: f64,
    pub height: f64,
    pub scroll_x: f64,
    pub scroll_y: f64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackComment {
    pub id: String,
    pub message: String,
    pub position: Point,
    pub card_position: Point,
    pub selection: Option<Selection>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Selection {
    pub kind: SelectionKind,
    pub rect: Rect,
    pub element: Option<ElementContext>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SelectionKind {
    Element,
    Region,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ElementContext {
    pub tag: String,
    pub id: Option<String>,
    pub classes: Vec<String>,
    pub role: Option<String>,
    pub accessible_name: Option<String>,
    pub text: Option<String>,
    pub selector: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct DrawingStroke {
    pub id: String,
    pub points: Vec<Point>,
    pub color: String,
    pub width: f64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackManifest {
    pub version: u8,
    pub received_at_unix_ms: u128,
    pub session_id: String,
    pub message: String,
    pub page: PageContext,
    pub comments: Vec<FeedbackComment>,
    pub drawings: Vec<DrawingStroke>,
    pub screenshot_path: String,
    pub trust: TrustBoundary,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrustBoundary {
    pub page_content: &'static str,
    pub note: &'static str,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackReceipt {
    pub version: u8,
    pub status: &'static str,
    pub message: String,
    pub page_url: String,
    pub comment_count: usize,
    pub drawing_stroke_count: usize,
    pub comment_summaries: Vec<String>,
    pub manifest_path: String,
    pub screenshot_path: String,
}

impl FeedbackSubmission {
    pub fn validate_and_sanitize(mut self, expected_session: &str) -> Result<Self, String> {
        if self.session_id != expected_session {
            return Err("the feedback session does not match the waiting CLI".into());
        }

        self.message = self.message.trim().to_string();
        if self.message.chars().count() > MAX_MESSAGE_CHARS {
            return Err(format!(
                "the overall note exceeds the {MAX_MESSAGE_CHARS}-character limit"
            ));
        }
        if self.comments.len() > MAX_COMMENTS {
            return Err(format!("feedback exceeds the {MAX_COMMENTS}-comment limit"));
        }
        if self.drawings.len() > MAX_DRAWING_STROKES {
            return Err(format!(
                "feedback exceeds the {MAX_DRAWING_STROKES}-stroke limit"
            ));
        }
        if self.message.is_empty() && self.comments.is_empty() && self.drawings.is_empty() {
            return Err("feedback needs an overall note, a comment, or a drawing".into());
        }

        let mut page_url = Url::parse(&self.page.url)
            .map_err(|_| "the page URL is not a valid absolute URL".to_string())?;
        if !matches!(page_url.scheme(), "http" | "https") {
            return Err("the page URL must use http or https".into());
        }
        page_url.set_query(None);
        page_url.set_fragment(None);
        self.page.url = page_url.to_string();
        self.page.title = truncate(&self.page.title, 300);

        validate_viewport(&self.page.viewport)?;
        if !self.page.device_pixel_ratio.is_finite()
            || !(0.1..=10.0).contains(&self.page.device_pixel_ratio)
        {
            return Err("the device pixel ratio is outside the supported range".into());
        }

        let mut comment_ids = HashSet::new();
        for comment in &mut self.comments {
            comment.id = truncate(comment.id.trim(), 100);
            if comment.id.is_empty() || !comment_ids.insert(comment.id.clone()) {
                return Err("every comment needs a unique non-empty id".into());
            }
            comment.message = comment.message.trim().to_string();
            if comment.message.is_empty() {
                return Err("every selected item or area needs a comment".into());
            }
            if comment.message.chars().count() > MAX_COMMENT_CHARS {
                return Err(format!(
                    "a comment exceeds the {MAX_COMMENT_CHARS}-character limit"
                ));
            }
            validate_point(&comment.position)?;
            validate_point(&comment.card_position)?;
            if let Some(selection) = &mut comment.selection {
                sanitize_selection(selection)?;
            }
        }

        let mut point_count = 0usize;
        let mut drawing_ids = HashSet::new();
        for stroke in &mut self.drawings {
            stroke.id = truncate(stroke.id.trim(), 100);
            if stroke.id.is_empty() || !drawing_ids.insert(stroke.id.clone()) {
                return Err("every drawing stroke needs a unique non-empty id".into());
            }
            if stroke.points.is_empty() {
                return Err("drawing strokes cannot be empty".into());
            }
            point_count = point_count.saturating_add(stroke.points.len());
            if point_count > MAX_DRAWING_POINTS {
                return Err(format!(
                    "feedback exceeds the {MAX_DRAWING_POINTS}-drawing-point limit"
                ));
            }
            for point in &stroke.points {
                validate_point(point)?;
            }
            if !stroke.width.is_finite() || !(0.5..=32.0).contains(&stroke.width) {
                return Err("a drawing stroke has an unsupported width".into());
            }
            if !is_hex_color(&stroke.color) {
                return Err("a drawing stroke has an unsupported color".into());
            }
            stroke.color.make_ascii_lowercase();
        }

        if !self
            .screenshot_data_url
            .starts_with("data:image/png;base64,")
        {
            return Err("the screenshot must be a PNG data URL".into());
        }

        Ok(self)
    }
}

impl FeedbackComment {
    pub fn summary(&self, number: usize) -> String {
        let target = self.selection.as_ref().map_or_else(
            || {
                format!(
                    "page point ({:.0}, {:.0})",
                    self.position.x, self.position.y
                )
            },
            Selection::summary,
        );
        format!(
            "{number}. \"{}\" on {}",
            truncate(&self.message, 160),
            target
        )
    }
}

impl Selection {
    pub fn summary(&self) -> String {
        match (&self.kind, &self.element) {
            (SelectionKind::Element, Some(element)) => {
                let name = element
                    .accessible_name
                    .as_deref()
                    .or(element.text.as_deref())
                    .filter(|value| !value.is_empty());
                match name {
                    Some(name) => format!("{} \"{}\" ({})", element.tag, name, element.selector),
                    None => format!("{} ({})", element.tag, element.selector),
                }
            }
            (SelectionKind::Element, None) => "element".into(),
            (SelectionKind::Region, _) => format!(
                "region x={:.0} y={:.0} width={:.0} height={:.0}",
                self.rect.x, self.rect.y, self.rect.width, self.rect.height
            ),
        }
    }
}

fn sanitize_selection(selection: &mut Selection) -> Result<(), String> {
    validate_rect(&selection.rect)?;
    if let Some(element) = &mut selection.element {
        element.tag = truncate(&element.tag.to_ascii_lowercase(), 80);
        element.id = element.id.take().map(|value| truncate(&value, 200));
        element.classes = element
            .classes
            .iter()
            .take(20)
            .map(|value| truncate(value, 120))
            .collect();
        element.role = element.role.take().map(|value| truncate(&value, 120));
        element.accessible_name = element
            .accessible_name
            .take()
            .map(|value| truncate(&value, 300));
        element.text = element.text.take().map(|value| truncate(&value, 500));
        element.selector = truncate(&element.selector, 1_000);
    }
    Ok(())
}

fn validate_viewport(viewport: &Viewport) -> Result<(), String> {
    for value in [
        viewport.width,
        viewport.height,
        viewport.scroll_x,
        viewport.scroll_y,
    ] {
        if !value.is_finite() || value.abs() > 1_000_000.0 {
            return Err("the viewport contains an invalid coordinate".into());
        }
    }
    if viewport.width <= 0.0 || viewport.height <= 0.0 {
        return Err("the viewport dimensions must be positive".into());
    }
    Ok(())
}

fn validate_rect(rect: &Rect) -> Result<(), String> {
    for value in [rect.x, rect.y, rect.width, rect.height] {
        if !value.is_finite() || value.abs() > 1_000_000.0 {
            return Err("a comment selection contains an invalid coordinate".into());
        }
    }
    if rect.width <= 0.0 || rect.height <= 0.0 {
        return Err("a comment selection must have positive dimensions".into());
    }
    Ok(())
}

fn validate_point(point: &Point) -> Result<(), String> {
    if !point.x.is_finite()
        || !point.y.is_finite()
        || point.x.abs() > 1_000_000.0
        || point.y.abs() > 1_000_000.0
    {
        return Err("a drawing stroke contains an invalid coordinate".into());
    }
    Ok(())
}

fn is_hex_color(value: &str) -> bool {
    value.len() == 7
        && value.starts_with('#')
        && value[1..].bytes().all(|value| value.is_ascii_hexdigit())
}

fn truncate(value: &str, max_chars: usize) -> String {
    value.chars().take(max_chars).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn selection() -> Selection {
        Selection {
            kind: SelectionKind::Element,
            rect: Rect {
                x: 100.0,
                y: 50.0,
                width: 180.0,
                height: 44.0,
            },
            element: Some(ElementContext {
                tag: "BUTTON".into(),
                id: Some("save".into()),
                classes: vec!["primary".into()],
                role: Some("button".into()),
                accessible_name: Some("Save".into()),
                text: Some("Save".into()),
                selector: "#save".into(),
            }),
        }
    }

    fn submission() -> FeedbackSubmission {
        FeedbackSubmission {
            session_id: "session".into(),
            message: "  Overall thought  ".into(),
            page: PageContext {
                url: "http://localhost:5173/example?token=secret#section".into(),
                title: "Example".into(),
                viewport: Viewport {
                    width: 1_200.0,
                    height: 800.0,
                    scroll_x: 0.0,
                    scroll_y: 100.0,
                },
                device_pixel_ratio: 2.0,
            },
            comments: vec![FeedbackComment {
                id: "comment-1".into(),
                message: "  Make this clearer  ".into(),
                position: Point { x: 280.0, y: 72.0 },
                card_position: Point { x: 294.0, y: 72.0 },
                selection: Some(selection()),
            }],
            drawings: vec![DrawingStroke {
                id: "stroke-1".into(),
                points: vec![Point { x: 1.0, y: 2.0 }, Point { x: 3.0, y: 4.0 }],
                color: "#DC5835".into(),
                width: 4.0,
            }],
            screenshot_data_url: "data:image/png;base64,iVBORw0KGgo=".into(),
        }
    }

    #[test]
    fn sanitizes_batched_feedback_and_url() {
        let value = submission().validate_and_sanitize("session").unwrap();
        assert_eq!(value.message, "Overall thought");
        assert_eq!(value.page.url, "http://localhost:5173/example");
        assert_eq!(value.comments[0].message, "Make this clearer");
        assert_eq!(
            value.comments[0]
                .selection
                .as_ref()
                .unwrap()
                .element
                .as_ref()
                .unwrap()
                .tag,
            "button"
        );
        assert_eq!(value.drawings[0].color, "#dc5835");
    }

    #[test]
    fn accepts_comments_without_an_overall_note() {
        let mut value = submission();
        value.message.clear();
        assert!(value.validate_and_sanitize("session").is_ok());
    }

    #[test]
    fn accepts_a_free_floating_sticky_note() {
        let mut value = submission();
        value.message.clear();
        value.comments[0].selection = None;
        value.drawings.clear();
        let value = value.validate_and_sanitize("session").unwrap();
        assert!(value.comments[0].selection.is_none());
    }

    #[test]
    fn rejects_a_different_session() {
        let error = submission().validate_and_sanitize("other").unwrap_err();
        assert!(error.contains("does not match"));
    }

    #[test]
    fn rejects_completely_empty_feedback() {
        let mut value = submission();
        value.message.clear();
        value.comments.clear();
        value.drawings.clear();
        assert!(value.validate_and_sanitize("session").is_err());
    }

    #[test]
    fn rejects_duplicate_comment_ids() {
        let mut value = submission();
        value.comments.push(value.comments[0].clone());
        assert!(value.validate_and_sanitize("session").is_err());
    }

    #[test]
    fn rejects_duplicate_drawing_ids() {
        let mut value = submission();
        value.drawings.push(value.drawings[0].clone());
        let error = value.validate_and_sanitize("session").unwrap_err();
        assert!(error.contains("drawing stroke"));
    }

    #[test]
    fn rejects_an_invalid_sticky_card_position() {
        let mut value = submission();
        value.comments[0].card_position.x = f64::INFINITY;
        let error = value.validate_and_sanitize("session").unwrap_err();
        assert!(error.contains("invalid coordinate"));
    }
}
