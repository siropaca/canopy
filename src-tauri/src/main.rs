// macOS only, so the Windows-specific `windows_subsystem` attribute is not needed
// (docs/adr/0014-macos-only.md).
fn main() {
    canopy_lib::run();
}
