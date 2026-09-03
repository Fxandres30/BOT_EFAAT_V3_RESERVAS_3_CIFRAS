import { supabase } from "@/lib/supabase";

export async function login(
    email: string,
    password: string
){

    return await supabase.auth.signInWithPassword({

        email,
        password

    });

}