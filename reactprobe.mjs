import Kahoot from "kahoot.js-latest";
import { sendReaction } from "./lib/reaction.js";

const name = "r" + Date.now().toString(36).slice(-6);
const c = new Kahoot();
c.on("Joined", async () => {
  console.log("joined as", name);
  for (const type of ["ThumbsUp", "Clap", "Heart"]) {
    try {
      const r = await sendReaction(c, type);
      console.log(`REACTION ${type}: ACCEPTED timetrack=${r?.ext?.timetrack}`);
    } catch (e) {
      console.log(`REACTION ${type}: REJECTED`, JSON.stringify(e));
    }
  }
  c.leave(true);
  setTimeout(() => process.exit(0), 500);
});
c.on("Disconnect", (r) => { console.log("disconnect:", r); process.exit(0); });
c.join("562917", name).then(() => console.log("join resolved")).catch(e => console.log("join failed:", JSON.stringify(e)));
setTimeout(() => { console.log("timeout exit"); process.exit(0); }, 60000);
