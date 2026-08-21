//! DTOs shared with the frontend.
//!
//! The shape is defined in docs/specs/data-model.md.
//! TypeScript types are generated from these structs (docs/adr/0013-type-generation.md).

mod change;

pub use change::{Change, ChangeList};

/// Assert that every key serde emits also appears in the generated TypeScript
/// declaration.
///
/// serde と ts-rs は別々に rename できる。片方だけ変えると、TypeScript の型と
/// 実行時の JSON が静かにずれる。DTO を足したらこの関数に通す。
#[cfg(test)]
pub(crate) fn assert_serde_keys_match_ts<T>(value: &T)
where
    T: serde::Serialize + ts_rs::TS,
{
    let json = serde_json::to_value(value).expect("DTO should serialize");
    let object = json.as_object().expect("DTO should serialize to an object");
    let declaration = T::decl(&ts_rs::Config::default());

    for key in object.keys() {
        assert!(
            declares_field(&declaration, key),
            "serde のキー {key} が TypeScript の宣言に無い: {declaration}"
        );
    }
}

/// Whether `declaration` declares a field named exactly `key`.
#[cfg(test)]
fn declares_field(declaration: &str, key: &str) -> bool {
    let needle = format!("{key}:");
    declaration.match_indices(&needle).any(|(at, _)| {
        declaration[..at]
            .chars()
            .next_back()
            .is_none_or(|before| !before.is_alphanumeric() && before != '_')
    })
}

#[cfg(test)]
mod tests {
    use super::declares_field;

    /// 部分一致で通してしまわない
    #[test]
    fn does_not_match_a_field_whose_name_ends_with_the_key() {
        let declaration = "type T = { subtotal: number, origin_url: string, };";

        assert!(declares_field(declaration, "subtotal"));
        assert!(declares_field(declaration, "origin_url"));
        assert!(!declares_field(declaration, "total"));
        assert!(!declares_field(declaration, "url"));
    }
}
