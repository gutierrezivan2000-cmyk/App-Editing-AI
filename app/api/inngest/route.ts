import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { procesarVideo } from "@/inngest/functions/pipeline";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [procesarVideo],
});
