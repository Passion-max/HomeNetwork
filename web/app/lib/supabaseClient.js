// Supabase browser client — only created when the hosted build provides the
// public env vars. When absent (the home single-process build), CLOUD is false
// and the app talks to the local /api/* backend instead.
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const CLOUD = !!(url && anon);
export const supabase = CLOUD
  ? createClient(url, anon, { auth: { persistSession: true, autoRefreshToken: true } })
  : null;
