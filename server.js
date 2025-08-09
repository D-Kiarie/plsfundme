const express = require("express");
const fetch = require("node-fetch");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3000;

const corsOptions = {
  origin: 'https://d-kiarie.github.io', // Allow requests only from your frontend's domain
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions));

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

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

// CORRECTED: This function now correctly returns the raw game data from the API.
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

async function getGameIcons(universeIds) {
  if (!universeIds || universeIds.length === 0) {
    return {};
  }
  const idsString = universeIds.join(',');
  const url = `https://thumbnails.roblox.com/v1/games/icons?universeIds=${idsString}&size=150x150&format=Png&isCircular=false`;
  const res = await fetch(url);
  const data = await res.json();
  const iconMap = {};
  if (data.data) {
    data.data.forEach(iconInfo => {
      if (iconInfo.state === 'Completed') {
        iconMap[iconInfo.targetId] = iconInfo.imageUrl;
      }
    });
  }
  return iconMap;
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

app.get("/games/:identifier", async (req, res) => {
  try {
    const { identifier } = req.params;
    let userId;
    let username;

    if (/^\d+$/.test(identifier)) {
      userId = identifier;
      const userResponse = await fetch(`https://users.roblox.com/v1/users/${userId}`);
      if (userResponse.ok) {
        const userData = await userResponse.json();
        username = userData.name;
      } else {
        return res.status(404).json({ error: `User with ID ${userId} not found.` });
      }
    } else {
      username = identifier;
      userId = await getUserId(username);
    }

    if (!userId) {
      return res.status(404).json({ error: `User with username "${username}" not found.` });
    }

    const games = await getProfileGames(userId);
    // CORRECTED: We now correctly get the universe IDs from the 'id' property of each game.
    const universeIds = games.map(game => game.id);
    const iconMap = await getGameIcons(universeIds);

    const gamesWithIcons = games.map(game => ({
      universeId: game.id,
      placeId: game.rootPlace ? game.rootPlace.id : null,
      name: game.name,
      creator: game.creator,
      placeVisits: game.placeVisits,
      // CORRECTED: We look up the icon using the correct universe ID.
      iconUrl: iconMap[game.id] || null
    }));

    res.json({
      username: username,
      userId: userId,
      totalGames: games.length,
      games: gamesWithIcons
    });

  } catch (err) {
    console.error("A critical error occurred while fetching games:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});


app.get("/gamepasses/:identifier", async (req, res) => {
  try {
    const { identifier } = req.params;
    let userId;
    let username;

    if (/^\d+$/.test(identifier)) {
      userId = identifier;
      const userResponse = await fetch(`https://users.roblox.com/v1/users/${userId}`);
      if (userResponse.ok) {
        const userData = await userResponse.json();
        username = userData.name;
      } else {
        return res.status(404).json({ error: `User with ID ${userId} not found.` });
      }
    } else {
      username = identifier;
      userId = await getUserId(username);
    }

    if (!userId) {
      return res.status(404).json({ error: `User with username "${username}" not found.` });
    }

    const games = await getProfileGames(userId);
    let allPasses = [];

    for (const game of games) {
      try {
        const passes = await getGamePasses(game.id);
        allPasses.push({
          gameName: game.name,
          universeId: game.id,
          passes: passes
        });
        await delay(250);
      } catch (gameError) {
        console.error(`Failed to fetch passes for game ${game.id} (${game.name}). Error:`, gameError.message);
        allPasses.push({
          gameName: game.name,
          universeId: game.id,
          passes: []
        });
      }
    }

    res.json({
      username: username,
      userId: userId,
      totalGames: games.length,
      totalPasses: allPasses.reduce((sum, g) => sum + g.passes.length, 0),
      games: allPasses
    });
  } catch (err) {
    console.error("A critical error occurred:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
