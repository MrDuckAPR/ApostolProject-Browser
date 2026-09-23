// Made by MrDuck
//! Command handlers grouped by domain.
//!
//! Each submodule owns one feature domain and mirrors the frontend module
//! of the same name under `ui/src/features/` (see `readme/ARCHITECTURE.md`):
//!
//! Frontend ownership lives in `ui/src/features/<feature>`; native adapters
//! live here in `features/<feature>/mod.rs`. Shared domain logic stays in
//! workspace crates instead of being duplicated in command handlers.

pub mod ai;
pub mod bookmarks;
pub mod debug;
pub mod downloads;
pub mod extensions;
pub mod experimental;
pub mod history;
pub mod maintenance;
pub mod network;
pub mod notes;
pub mod pages;
pub mod palette;
pub mod privacy;
pub mod profiles;
pub mod profile_sync;
pub mod session;
pub mod updater;
pub mod settings;
pub mod vault;
pub mod windowfx;
pub mod workspaces;

pub(crate) use ai::*;
pub(crate) use bookmarks::*;
pub(crate) use debug::*;
pub(crate) use downloads::*;
pub(crate) use extensions::*;
pub(crate) use experimental::*;
pub(crate) use history::*;
pub(crate) use maintenance::*;
pub(crate) use network::*;
pub(crate) use notes::*;
pub(crate) use pages::*;
pub(crate) use palette::*;
pub(crate) use privacy::*;
pub(crate) use profiles::*;
pub(crate) use profile_sync::*;
pub(crate) use session::*;
pub(crate) use updater::*;
pub(crate) use settings::*;
pub(crate) use vault::*;
pub(crate) use windowfx::*;
pub(crate) use workspaces::*;

// Made by MrDuck