import { supabase } from "@/lib/supabase";

export async function getUser(){

    return await supabase.auth.getUser();

}