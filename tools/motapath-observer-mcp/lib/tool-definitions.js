"use strict";

const TOOL_DEFINITIONS = [
  {
    name: "get_runtime_status",
    description: "Get the current solver runtime status, active task, progress metrics, and code/release identity.",
    inputSchema: {
      type: "object",
      properties: {
        run_id: {
          type: "string",
          description: "Optional run directory identifier (defaults to configured primary run, e.g. 'neko-zero-key')",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "list_durable_nodes",
    description: "List and aggregate durable checkpoint nodes in the search journal. Supports filtering by stage/tier/status and returns hero attribute distributions (ATK/DEF/HP/LV) across all matching nodes.",
    inputSchema: {
      type: "object",
      properties: {
        run_id: {
          type: "string",
          description: "Optional run directory identifier",
        },
        stage: {
          type: "integer",
          description: "Filter by stage index (0 for TS11, 1 for TS12, 2 for TS13, etc.)",
        },
        tier: {
          type: "integer",
          description: "Filter by budget tier (0, 1, 2, 3)",
        },
        status: {
          type: "string",
          enum: ["pending", "searched", "bounded", "goal", "running"],
          description: "Filter by node status",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 500,
          default: 50,
          description: "Maximum number of nodes to return in the paginated list",
        },
        offset: {
          type: "integer",
          minimum: 0,
          default: 0,
          description: "Pagination offset",
        },
        hero_aggregate: {
          type: "boolean",
          default: true,
          description: "Whether to include aggregated distribution of hero attributes (ATK, DEF, HP, etc.) across ALL matching nodes",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_durable_node",
    description: "Retrieve detailed information, hero stats, inventory, flags, and optional full state for a specific durable node ID.",
    inputSchema: {
      type: "object",
      properties: {
        node_id: {
          type: "string",
          description: "Checkpoint ID (e.g. '2-0241234b0ff83efa49a2fa5e' or '0-0786ff07331034bd3fc475df')",
        },
        run_id: {
          type: "string",
          description: "Optional run directory identifier",
        },
        include_full_state: {
          type: "boolean",
          default: false,
          description: "If true, loads full state file with all floorStates and tile modifications if available",
        },
      },
      required: ["node_id"],
      additionalProperties: false,
    },
  },
  {
    name: "get_attempt_history",
    description: "Retrieve search attempt history records from the journal, including expansions, frontier size, stop reason, and DP diagnostics summary.",
    inputSchema: {
      type: "object",
      properties: {
        node_id: {
          type: "string",
          description: "Optional filter by entry node checkpoint ID",
        },
        stage: {
          type: "integer",
          description: "Optional filter by stage index",
        },
        run_id: {
          type: "string",
          description: "Optional run directory identifier",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 100,
          default: 30,
          description: "Number of attempts to return (newest first)",
        },
        offset: {
          type: "integer",
          minimum: 0,
          default: 0,
          description: "Pagination offset",
        },
        include_diagnostics_summary: {
          type: "boolean",
          default: true,
          description: "Whether to include key DP diagnostics (pruned by higher HP, same HP, unique keys, registered nodes, etc.)",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_search_diagnostics",
    description: "Get detailed search, dominance, and pruning diagnostics for a specific task attempt, probe run, or latest attempt.",
    inputSchema: {
      type: "object",
      properties: {
        task_id: {
          type: "string",
          description: "Checkpoint/task ID (e.g. '2-0241234b0ff83efa49a2fa5e' or 'latest')",
        },
        tier: {
          type: "integer",
          description: "Optional task tier if task_id is specified",
        },
        run_id: {
          type: "string",
          description: "Optional run directory identifier",
        },
        probe_name: {
          type: "string",
          description: "Probe name to inspect (e.g. '256k', '128k')",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "analyze_stage_candidates",
    description: "Analyze candidate generation, archive retention, and skyline selection for a specific stage (e.g. TS12->TS13, stage 1). Answers questions like whether candidates with alternative ATK/DEF profiles were generated or pruned by top-16 capacity.",
    inputSchema: {
      type: "object",
      properties: {
        stage: {
          type: "integer",
          description: "Stage index to analyze (0 for TS11->TS12, 1 for TS12->TS13, 2 for TS13->TS14)",
        },
        run_id: {
          type: "string",
          description: "Optional run directory identifier",
        },
      },
      required: ["stage"],
      additionalProperties: false,
    },
  },
  {
    name: "inspect_frontier_snapshot",
    description: "Inspect active frontier and agenda distribution across floors, service order, waiting times, and eviction rates. Evaluates whether goal-floor candidates are starved by lower-floor preparation.",
    inputSchema: {
      type: "object",
      properties: {
        task_id: {
          type: "string",
          description: "Optional task ID, probe name (e.g. '256k'), or defaults to probe / active telemetry",
        },
        run_id: {
          type: "string",
          description: "Optional run directory identifier",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "read_artifact",
    description: "Safely read bounded content from whitelisted diagnostic and route artifact files (status, journal, preview, task, attempt, state, route, probe, manifest, log). Absolute paths and sensitive files are forbidden.",
    inputSchema: {
      type: "object",
      properties: {
        artifact_type: {
          type: "string",
          enum: ["status", "journal", "preview", "task", "attempt", "state", "route", "probe", "manifest", "log"],
          description: "Whitelisted artifact category",
        },
        id: {
          type: "string",
          description: "Sub-identifier (e.g. node_id for state/preview, probe name '256k', task ID '0-0786...-0', manifest type 'bundle')",
        },
        run_id: {
          type: "string",
          description: "Optional run directory identifier",
        },
        max_bytes: {
          type: "integer",
          minimum: 1024,
          maximum: 1048576,
          default: 262144,
          description: "Maximum bytes to read (bounded between 1KB and 1MB)",
        },
        json_path: {
          type: "string",
          description: "Optional dot-separated JSON key path to extract a subset of the JSON artifact (e.g. 'dp.memory', 'service.TS13')",
        },
      },
      required: ["artifact_type"],
      additionalProperties: false,
    },
  },
  {
    name: "read_bounded_log",
    description: "Safely read the tail of log files (worker.log, probe logs) with optional regex/substring pattern filtering.",
    inputSchema: {
      type: "object",
      properties: {
        source: {
          type: "string",
          description: "Log source ('worker', '256k', '128k')",
          default: "worker",
        },
        run_id: {
          type: "string",
          description: "Optional run directory identifier",
        },
        tail_lines: {
          type: "integer",
          minimum: 1,
          maximum: 300,
          default: 100,
          description: "Number of tail lines to return (max 300)",
        },
        pattern: {
          type: "string",
          description: "Optional regex or substring to filter lines",
        },
      },
      additionalProperties: false,
    },
  },
];

module.exports = { TOOL_DEFINITIONS };
