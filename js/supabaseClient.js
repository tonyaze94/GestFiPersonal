// -----------------------------------------------------------------------------
// Configuracao unica do projeto Supabase.
//
// SEGURANCA: a chave abaixo e a chave "publishable" (equivalente moderno da
// antiga "anon key"). E segura de expor num repositorio publico -- e desenhada
// para isso, tal como em qualquer app Supabase ou app movel nativa.
//
// A protecao real dos dados e o Row Level Security, ativo nas 13 tabelas, que
// restringe todas as operacoes a auth.uid() = user_id.
//
// NUNCA colocar aqui (nem em qualquer outro ficheiro do repositorio) a chave
// "sb_secret_..." / "service_role": essa ignora o RLS por completo.
// -----------------------------------------------------------------------------
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

export const SUPABASE_URL = 'https://sflmkefxuwsonkuyrlgh.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_eFXlLCezLuNCRecdfNhMhQ_MHXXCGFP';

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    // Sessao persistente no browser, com logout explicito na app.
    persistSession: true,
    storage: window.localStorage,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'pkce',
  },
});
