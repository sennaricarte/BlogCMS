import { useState } from "react";
import { createSupabaseBrowserClient } from "../../lib/supabase";

export default function LogoutButton() {
  const [loading, setLoading] = useState(false);

  async function handleClick() {
    setLoading(true);
    try {
      const supabase = createSupabaseBrowserClient();
      await supabase.auth.signOut();
    } catch {
      /* continuar para terminar a sessão local */
    } finally {
      window.location.assign("/admin/login/");
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={loading}
      className="flex min-h-10 w-full items-center justify-center gap-2 rounded-md border border-red-200/90 bg-red-50/50 px-3 py-2 text-left text-sm font-medium text-red-900 transition hover:bg-red-100/60 focus:outline-none focus:ring-2 focus:ring-red-900/15 disabled:opacity-60"
      aria-busy={loading}
      title="Sair e terminar a sessão no painel"
    >
      {loading ? "A sair…" : "Sair"}
    </button>
  );
}
