// Local store — reads from the SQLite history (queries.mjs) and writes device
// renames (db.mjs). This is the default, always-available backend; it never
// depends on the network. A cloud-backed reader (Supabase, Phase 4) implements
// the same shape so the API layer doesn't change.
import { getState, getThroughputHistory, getConsumption, getDeviceHistory, getUsageFor, getUsageSeries } from "../queries.mjs";
import { setDeviceName } from "../db.mjs";

export const localStore = {
  name: "local",
  getState,
  getHistory: getThroughputHistory,
  getConsumption,
  getDeviceHistory,
  getUsageFor,
  getUsageSeries,
  setDeviceName,
};
