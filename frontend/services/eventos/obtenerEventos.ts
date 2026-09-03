import { supabase } from "@/lib/supabase";

export async function obtenerEventos(){

    const {

        data,

        error

    }=await supabase

        .from("eventos_bot")

        .select("*")

        .order("fecha_evento",{

            ascending:false

        });

    if(error){

        console.log(error);

        return[];

    }

    return data;

}