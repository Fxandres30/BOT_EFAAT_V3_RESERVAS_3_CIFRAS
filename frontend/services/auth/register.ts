import { supabase } from "@/lib/supabase";

export async function register(
    email:string,
    password:string
){

    return await supabase.auth.signUp({

        email,
        password

    });

}