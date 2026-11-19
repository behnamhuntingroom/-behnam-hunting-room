import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://sbsalvbnozkmvmglhppr.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_fUXFAfepAtfg67_9ImF6Ow_DCHvA3qV";

const supabaseClient = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
});

window.BHR_SUPABASE = supabaseClient;
window.BHR_SUPABASE_READY = true;
window.dispatchEvent(new CustomEvent("bhr:supabase-ready"));

supabaseClient.auth.onAuthStateChange((event, session) => {
  window.dispatchEvent(new CustomEvent("bhr:auth-state", {
    detail: { event, session }
  }));
});
