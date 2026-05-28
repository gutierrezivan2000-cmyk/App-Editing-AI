import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { procesarVideo } from "@/inngest/functions/pipeline";
import { cortarSilencios } from "@/inngest/functions/cortar-silencios";
import { procesarCortesProyecto } from "@/inngest/functions/proyecto-cortes";
import {
  procesarMulticlipProyecto,
  rerenderizarMulticlipFinal,
  replanificarMulticlipFinal,
} from "@/inngest/functions/proyecto-multiclip";
import { procesarMontaje } from "@/inngest/functions/montaje";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    procesarVideo,
    cortarSilencios,
    procesarCortesProyecto,
    procesarMulticlipProyecto,
    rerenderizarMulticlipFinal,
    replanificarMulticlipFinal,
    procesarMontaje,
  ],
});
