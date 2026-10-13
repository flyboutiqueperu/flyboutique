import { createClient } from "@supabase/supabase-js";
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
if (!supabaseUrl || !supabaseKey) console.warn("Faltan VITE_SUPABASE_URL o VITE_SUPABASE_ANON_KEY");

// Dónde se guarda la sesión. Por defecto (clientas con Google) se recuerda en este navegador.
// Cuando alguien del staff entra SIN marcar "Mantener la sesión iniciada", se guarda solo en esta
// pestaña: al cerrar la página o el navegador, la sesión se cierra sola (más seguro en la tienda).
const TAB_ONLY_KEY = "fly-auth-solo-pestana";
const tabOnly = () => { try { return localStorage.getItem(TAB_ONLY_KEY) === "1"; } catch (e) { return false; } };
const store = () => { try { return tabOnly() ? window.sessionStorage : window.localStorage; } catch (e) { return null; } };
const authStorage = {
  getItem: (k) => { try { return store()?.getItem(k) ?? null; } catch (e) { return null; } },
  setItem: (k, v) => { try { store()?.setItem(k, v); } catch (e) { /* sin almacenamiento */ } },
  removeItem: (k) => { try { localStorage.removeItem(k); } catch (e) { /* nada */ } try { sessionStorage.removeItem(k); } catch (e) { /* nada */ } },
};
// Antes de iniciar sesión del staff: remember=true → se recuerda en este equipo; false → solo esta pestaña.
export const setStaffSessionMode = (remember) => { try { if (remember) localStorage.removeItem(TAB_ONLY_KEY); else localStorage.setItem(TAB_ONLY_KEY, "1"); } catch (e) { /* nada */ } };
export const clearStaffSessionMode = () => { try { localStorage.removeItem(TAB_ONLY_KEY); } catch (e) { /* nada */ } };

export const supabase = createClient(supabaseUrl, supabaseKey, { auth: { storage: authStorage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
