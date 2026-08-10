pub mod audit;
pub mod engine;
pub mod pending;
pub mod store;
pub mod types;

// Tauri commands (`lib.rs`) wire `store`, `audit`, `pending`, and `engine`
// together: policy mutations persist and resync the resident
// `AutonomyEngine` immediately, `RequiresApproval` decisions queue into
// `pending` instead of dead-ending in an error, and `list_autonomy_audit`
// surfaces `audit::verify_chain`'s result to the frontend.
