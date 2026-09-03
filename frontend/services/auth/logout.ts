import { supabase } from "@/lib/supabase";

export async function logout(){

    return await supabase.auth.signOut();

}