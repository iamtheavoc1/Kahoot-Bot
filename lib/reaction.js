// Reactions.
//
// `kahoot.js-latest` never implemented the reaction frame. The library is a
// partial reimplementation of Kahoot's protocol: it has a class per frame
// its author needed, and reactions were never one of them. The server does
// not know or care that the bot is a library, it only checks that a well
// formed frame arrives on the socket.
//
// The frame was read out of Kahoot's own web client, which is public
// JavaScript:
//
//   https://assets-cdn.kahoot.it/controller/v2/assets/controller-*.js
//
//     defineControllerMessage()(SUBMIT_REACTION, 47)
//     defineControllerMessage()(SUBMIT_EMOTE, 48)
//
// and the publish middleware, which is what turns an action into a frame:
//
//     this.publishMessage(cometd, {
//       gameid: pin,
//       type: PublishType.Message,
//       host: host,
//       id: gameServerCode,
//       content: JSON.stringify(data)
//     }, channel)
//
// So a reaction is game server code 47 on /service/controller, with the
// reaction type in the content. Identical in shape to the answer frame the
// library already sends.
//
// The same table gives the codes the library uses, which cross-checks:
// SUBMIT_FEEDBACK 11, GAME_BLOCK_ANSWER 45, SUBMIT_TWO_FACTOR 50,
// REQUEST_RECOVERY_DATA_FROM_PLAYER 16.

export const REACTION_ID = 47;
export const EMOTE_ID = 48;

export const REACTION_TYPES = Object.freeze([
  "ThumbsUp",
  "Clap",
  "Heart",
  "Haha",
  "Wow",
  "Thinking",
  "Popper",
  "Trophy",
  "Flame",
  "Victory",
]);

export const EMOTE_TYPES = Object.freeze(["Heart", "Trophy", "Victory"]);

// Kahoot's own client counts a reaction as spam when five land inside ten
// seconds, and starts penalising the player for it.
export const SPAM_THRESHOLD = 5;
export const SPAM_WINDOW_MS = 10000;

// The smallest gap that keeps one bot under the threshold.
export const SAFE_INTERVAL_MS = Math.ceil(SPAM_WINDOW_MS / (SPAM_THRESHOLD - 1));

class LiveBase {
  constructor(client, channel, data) {
    this.channel = channel;
    this.clientId = client.clientId;
    if (data) {
      this.data = data;
    }
    this.ext = {};
  }
}

export class LiveReaction extends LiveBase {
  constructor(client, reactionType) {
    super(client, "/service/controller", {
      gameid: client.gameid,
      host: "kahoot.it",
      id: REACTION_ID,
      type: "message",
      content: JSON.stringify({ reactionType }),
    });
  }
}

export class LiveEmote extends LiveBase {
  constructor(client, emoteType) {
    super(client, "/service/controller", {
      gameid: client.gameid,
      host: "kahoot.it",
      id: EMOTE_ID,
      type: "message",
      content: JSON.stringify({ emoteType }),
    });
  }
}

/**
 * Send a reaction. Resolves when the server acknowledges the frame.
 *
 * The acknowledgement is routed by the bayeux message id, which the library
 * handles for any frame, so a frame it has no class for still gets a reply.
 */
export function sendReaction(client, reactionType) {
  return new Promise((resolve, reject) => {
    client._send(new LiveReaction(client, reactionType), (result) => {
      if (!result || !result.successful) {
        reject(result);
      } else {
        resolve(result);
      }
    });
  });
}

/** Send an emote, which is the same frame with a different code and field. */
export function sendEmote(client, emoteType) {
  return new Promise((resolve, reject) => {
    client._send(new LiveEmote(client, emoteType), (result) => {
      if (!result || !result.successful) {
        reject(result);
      } else {
        resolve(result);
      }
    });
  });
}

/** Pick a reaction at random. */
export function randomReaction() {
  return REACTION_TYPES[Math.floor(Math.random() * REACTION_TYPES.length)];
}
