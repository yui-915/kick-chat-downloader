/// <reference lib="dom" />

"use strict";

const button = document.querySelector("button");
const status = document.querySelector("#status");
const input = document.querySelector("input");

button.onclick = () => {
  button.disabled = true;
  input.disabled = true;
  status.innerText = "Starting ...";
  setTimeout(async () => {
    try {
      await download_chat();
    } catch (e) {
      status.innerText = `Error: ${e}`;
      console.error(e);
    }
    button.disabled = false;
    input.disabled = false;
  }, 34);
};

async function download_chat() {
  const match = input.value.match(
    /(https:\/\/)?kick.com\/[^/]+\/videos\/([^/]+)/,
  );
  if (!match) throw new Error("Invalid url");
  const uuid = match[2];

  status.innerText = "Fetching stream metadata ...";
  const stream_res = await fetch(`https://kick.com/api/v1/video/${uuid}`);
  if (!stream_res.ok) {
    console.error(await stream_res.text);
    throw new Error(`Unable to fetch stream metadata: ${stream_res.status} ${stream_res.statusText}`);
  }
  const { livestream } = await stream_res.json();

  status.innerText = "Constructing promises list ...";

  const promises = [];
  const messages_list = [];
  let completed_count = 0;
  let error_count = 0;

  const duration = livestream.duration / 1000;
  for (let s = 0; s < duration; s += 5) {
    const start_time = new Date(livestream.start_time);
    start_time.setSeconds(start_time.getSeconds() + s);
    const url =
      `https://kick.com/api/v2/channels/${livestream.channel_id}/messages?start_time=${start_time.toISOString()}`;
    const promise = fetch(url).then((res) => res.json()).then((res) => {
      completed_count += 1;
      status.innerText = `Downloading messages ${completed_count}/${promises.length}`;

      if (!res.data || !res.data.messages) {
        error_count += 1;
        return console.error("Unknown res:", res);
      }

      const start_time = new Date(livestream.start_time);
      for (const msg of res.data.messages) {
        if (
          !msg.created_at || !msg.sender || !msg.sender.username || !msg.sender.identity ||
          !msg.sender.identity.color || !msg.content
        ) {
          console.error("Unknown message in res:", res);
          error_count += 1;
          continue;
        }
        const time = Math.floor((new Date(msg.created_at).getTime() - start_time) / 1000);
        const user_name = msg.sender.username;
        const user_color = msg.sender.identity.color;
        let message = msg.content
          .replaceAll(/\[emote:\d+:([^\]]+)\]/g, (_, n) => n)
          .replaceAll("\n", "");
        if (msg.type == "reply") {
          message = `@${JSON.parse(msg.metadata).original_message.sender.username} ${message}`;
        }
        messages_list.push({ time, user_name, user_color, message });
      }
    });
    promises.push(promise);
  }
  status.innerText = `Starting download ...`;

  await Promise.all(promises);

  status.innerText = `Building csv...`;

  const messages_csv = messages_list
    .sort((a, b) => a.time - b.time)
    .map((msg) => `${msg.time},${msg.user_name},${msg.user_color},"${msg.message}"`)
    .join("\n");
  const csv = "time,user_name,user_color,message\n" + messages_csv;

  status.innerText = `Saving file...`;

  const blob = new Blob([csv], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `kick-chat-${livestream.start_time.slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  if (error_count == 0) status.innerText = "Done!";
  else status.innerText = "Done! but there were some errors (check console)";
}
