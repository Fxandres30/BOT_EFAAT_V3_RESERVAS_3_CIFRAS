export interface DashboardResumen {

    bots: number;

    sesiones: number;

    eventos: number;

    reservas: number;

    clientes: number;

    chats: number;

    grupos: number;

    ventas: number;

}

export interface DashboardCardsProps {

    resumen: DashboardResumen;

}