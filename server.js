const express = require("express");
const fetch = require("node-fetch");

const app = express();
const PORT = process.env.PORT || 3000;

// NEW: Add a root route to keep the service alive
app.get("/", (req, res) => {
  res.status(200).json({ message: "Server is alive and running!" });
});

async function getUserId(username) {
  const res = await fetch(`https://users.roblox.com/v1/usernames/users`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ usernames: [username], excludeBannedUsers: true })
  });
  const data = await res.json();
  if (data.data && data.data.length > 0) {
    return data.data[0].id;
  }
  return null;
}

async function getProfileGames(userId) {
  let games = [];
  let cursor = "";
  do {
    const res = await fetch(`https://games.roblox.com/v2/users/${userId}/games?sortOrder=Asc&limit=50&cursor=${cursor}`);
    const data = await res.json();
    if (data.data) {
      const profileGames = data.data.filter(game => game.creator.type === "User");
      games = games.concat(profileGames);
    }
    cursor = data.nextPageCursor || "";
  } while (cursor);
  return games;
}

async function getGamePasses(universeId) {
  let passes = [];
  let cursor = "";
  do {
    const res = await fetch(`https://games.roblox.com/v1/games/${universeId}/game-passes?limit=100&sortOrder=Asc&cursor=${cursor}`);
    const data = await res.json();
    if (data.data) passes = passes.concat(data.data);
    cursor = data.nextPageCursor || "";
  } while (cursor);
  return passes;
}

app.get("/gamepasses/:username", async (req, res) => {
  try {
    const username = req.params.username;
    const userId = await getUserId(username);

    if (!userId) {
        return res.status(404).json({ error: "User not found" });
    }

    const games = await getProfileGames(userId);
    let allPasses = [];

    for (let game of games) {
      const passes = await getGamePasses(game.id);
      allPasses.push({
        gameName: game.name,
        universeId: game.id,
        passes: passes
      });
    }

    res.json({
      username: username,
      userId: userId,
      totalGames: games.length,
      totalPasses: allPasses.reduce((sum, g) => sum + g.passes.length, 0),
      games: allPasses
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
