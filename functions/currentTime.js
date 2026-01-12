async function currentTime(functionArgs) {
  console.log("GPT -> called currentTime function");

  const now = new Date();
  // Format as HH:MM AM/PM in Pacific time (PST/PDT)
  const timeString = now.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: 'America/Los_Angeles',
  });

  return timeString;
}

module.exports = currentTime;
