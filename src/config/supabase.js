import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_PUBLISHABLE_KEY in environment variables.");
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

export default supabase;
