import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { procesarVideo } from "@/inngest/functions/pipeline";
import { cortarSilencios } from "@/inngest/functions/cortar-silencios";
import { procesarCortesProyecto } from "@/inngest/functions/proyecto-cortes";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [procesarVideo, cortarSilencios, procesarCortesProyecto],
});
