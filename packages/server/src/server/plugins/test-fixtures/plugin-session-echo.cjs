process.on("message", (message) => {
  if (message?.type !== "gravity_frame") return;
  process.send?.(message);
});
