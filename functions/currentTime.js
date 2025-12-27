async function currentTime(functionArgs) {
  console.log("GPT -> called currentTime function");

  const now = new Date();
  // Format as HH:MM AM/PM in local time
  const timeString = now.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });

  return timeString;
}

module.exports = currentTime;
