const express = require("express");
const fetch = require("node-fetch");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3000;

const corsOptions = {
  origin: 'https://d-kiarie.github.io',
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions));

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function robustFetch(url, options, retries = 5, delayMs = 500) {
  for (let i = 0; i <= retries; i++) {
    try {
        const res = await fetch(url, options);
        if (res.ok) {
            return await res.json();
        }
        if (res.status >= 400 && res.status < 500) {
            throw new Error(`Client error: ${res.status}`);
        }
        console.warn(`Request to ${url} failed with status ${res.status}. Retrying in ${delayMs * (i + 1)}ms...`);
        await delay(delayMs * (i + 1));
    } catch (error) {
        if (i === retries) {
            throw new Error(`Failed to fetch from ${url} after ${retries + 1} attempts: ${error.message}`);
        }
        await delay(delayMs * (i + 1));
    }
  }
}


app.get("/", (req, res) => {
  res.status(200).json({ message: "Server is alive and running!" });
});

async function getUserId(username) {
  const data = await robustFetch(`https://users.roblox.com/v1/usernames/users`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ usernames: [username], excludeBannedUsers: true })
  });
  if (data && data.data && data.data.length > 0) {
    return data.data[0].id;
  }
  return null;
}

async function getProfileGames(userId) {
  let games = [];
  let cursor = "";
  do {
    const data = await robustFetch(`https://games.roblox.com/v2/users/${userId}/games?sortOrder=Asc&limit=50&cursor=${cursor}`);
    if (data && data.data) {
      const profileGames = data.data.filter(game => game.creator.type === "User");
      games = games.concat(profileGames);
    }
    cursor = data ? data.nextPageCursor : "";
  } while (cursor);
  return games;
}

async function getOwnedGroups(userId) {
    let ownedGroups = [];
    let cursor = "";
    do {
        const data = await robustFetch(`https://groups.roblox.com/v2/users/${userId}/groups/roles?cursor=${cursor}&limit=100&sortOrder=Asc`);
        if (data && data.data) {
            data.data.forEach(item => {
                if (item.role.name === 'Owner') {
                    ownedGroups.push(item.group);
                }
            });
        }
        cursor = data ? data.nextPageCursor : "";
    } while (cursor);
    return ownedGroups;
}

async function getGroupGames(groupId) {
    let games = [];
    let cursor = "";
    do {
        const data = await robustFetch(`https://games.roblox.com/v2/groups/${groupId}/games?sortOrder=Asc&limit=50&cursor=${cursor}`);
        if (data && data.data) {
            games = games.concat(data.data);
        }
        cursor = data ? data.nextPageCursor : "";
    } while (cursor);
    return games;
}


async function getGamePasses(universeId) {
  let passes = [];
  let cursor = "";
  do {
    const data = await robustFetch(`https://games.roblox.com/v1/games/${universeId}/game-passes?limit=100&sortOrder=Asc&cursor=${cursor}`);
    if (data && data.data) passes = passes.concat(data.data);
    cursor = data ? data.nextPageCursor : "";
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

    const profileGames = await getProfileGames(userId);
    let ownedGroups = [];
    try {
        ownedGroups = await getOwnedGroups(userId);
    } catch(err) {
        console.error("Failed to fetch owned groups:", err.message);
    }
    
    let allGroupGames = [];
    for (const group of ownedGroups) {
        try {
            const groupGames = await getGroupGames(group.id);
            allGroupGames = allGroupGames.concat(groupGames);
        } catch (groupError) {
            console.error(`Failed to fetch games for group ${group.id} (${group.name}). Error:`, groupError.message);
        }
    }

    const allGames = profileGames.concat(allGroupGames);

    const gamesWithIcons = allGames.map(game => ({
      universeId: game.id,
      placeId: game.rootPlace ? game.rootPlace.id : null,
      name: game.name,
      creator: game.creator,
      placeVisits: game.placeVisits,
      iconUrl: `rbxthumb://type=GameIcon&id=${game.id}&w=150&h=150`
    }));

    res.json({
      username: username,
      userId: userId,
      totalGames: allGames.length,
      ownedGroups: ownedGroups,
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

    const profileGames = await getProfileGames(userId);
    let ownedGroups = [];
    try {
        ownedGroups = await getOwnedGroups(userId);
    } catch(err) {
        console.error("Failed to fetch owned groups:", err.message);
    }
    
    let allGroupGames = [];
    for (const group of ownedGroups) {
        try {
            const groupGames = await getGroupGames(group.id);
            allGroupGames = allGroupGames.concat(groupGames);
        } catch (groupError) {
            console.error(`Failed to fetch games for group ${group.id} (${group.name}). Error:`, groupError.message);
        }
    }

    const allGames = profileGames.concat(allGroupGames);
    let allPasses = [];

    for (const game of allGames) {
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
      totalGames: allGames.length,
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
