const express = require("express");
const fetch = require("node-fetch");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3000;

const ROBLOX_COOKIE = process.env.ROBLOSECURITY_COOKIE;

const corsOptions = {
  origin: 'https://d-kiarie.github.io',
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions));

let csrfToken = "";

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function fetchCsrfToken() {
    try {
        const res = await fetch('https://auth.roblox.com/v2/logout', {
            method: 'POST',
            headers: {
                'Cookie': `.ROBLOSECURITY=${ROBLOX_COOKIE}`
            }
        });
        const token = res.headers.get('x-csrf-token');
        if (!token) {
            throw new Error('Could not fetch CSRF token from response headers.');
        }
        csrfToken = token;
        console.log("Successfully fetched new CSRF token.");
        return token;
    } catch (error) {
        console.error("Fatal error fetching CSRF token:", error.message);
        throw error;
    }
}

async function robustFetch(url, options = {}, retries = 5, delayMs = 500) {
  if (options.method === 'POST' && !csrfToken) {
    await fetchCsrfToken();
  }

  for (let i = 0; i <= retries; i++) {
    const finalOptions = {
        ...options,
        redirect: 'follow',
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Cookie': `.ROBLOSECURITY=${ROBLOX_COOKIE}`,
            ...options.headers,
        }
    };

    if (options.method === 'POST') {
        finalOptions.headers['x-csrf-token'] = csrfToken;
    }

    try {
      const res = await fetch(url, finalOptions);

      if (res.status === 403 && (await res.text()).includes('Token Validation Failed')) {
          console.log("CSRF token rejected. Fetching a new one...");
          await fetchCsrfToken();
          console.log(`Retrying request (attempt ${i + 1}/${retries + 1})...`);
          await delay(delayMs);
          continue;
      }

      if (res.ok) {
        return await res.json();
      }

      if (res.status >= 400 && res.status < 500) {
        const errorText = await res.text();
        console.error(`Client error response for ${url}: ${errorText}`);
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
  const url = `https://users.roblox.com/v1/usernames/users`;
  const data = await robustFetch(url, {
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
    const url = `https://games.roblox.com/v2/users/${userId}/games?sortOrder=Asc&limit=50&cursor=${cursor}`;
    const data = await robustFetch(url);
    if (data && data.data) {
      const profileGames = data.data.filter(game => game.creator.type === "User");
      games = games.concat(profileGames);
    }
    cursor = data ? data.nextPageCursor : "";
  } while (cursor);
  return games;
}

async function getOwnedGroups(userId) {
    const url = `https://groups.roblox.com/v1/users/${userId}/groups/roles`;
    const data = await robustFetch(url);
    const ownedGroups = [];
    if (data && data.data) {
        data.data.forEach(item => {
            if (item.role.rank === 255) {
                ownedGroups.push(item.group);
            }
        });
    }
    return ownedGroups;
}

async function getAllUserGroups(userId) {
    const url = `https://groups.roblox.com/v1/users/${userId}/groups/roles`;
    const data = await robustFetch(url);
    let allGroups = [];
    if (data && data.data) {
        allGroups = data.data.map(item => item.group);
    }
    return allGroups;
}

async function getGroupGames(groupId) {
    let games = [];
    let cursor = "";
    do {
        const url = `https://games.roblox.com/v2/groups/${groupId}/games?accessFilter=2&sortOrder=Asc&limit=50&cursor=${cursor}`;
        const data = await robustFetch(url);
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
    const url = `https://games.roblox.com/v1/games/${universeId}/game-passes?limit=100&sortOrder=Asc&cursor=${cursor}`;
    const data = await robustFetch(url);
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
      const userResponse = await robustFetch(`https://users.roblox.com/v1/users/${userId}`);
      if (userResponse) {
        username = userResponse.name;
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
            await delay(250);
        } catch (groupError) {
            console.error(`Failed to fetch games for group ${group.id} (${group.name}). Error:`, groupError.message);
        }
    }

    const allGames = profileGames.concat(allGroupGames);

    const gamesWithAssets = allGames.map(game => ({
      universeId: game.id,
      placeId: game.rootPlace ? game.rootPlace.id : null,
      name: game.name,
      creator: game.creator,
      placeVisits: game.placeVisits,
      iconUrl: `rbxthumb://type=GameIcon&id=${game.id}&w=150&h=150`,
      thumbnailUrl: `rbxthumb://type=GameThumbnail&id=${placeId}&w=768&h=432`
    }));

    res.json({
      username: username,
      userId: userId,
      totalGames: allGames.length,
      ownedGroups: ownedGroups,
      games: gamesWithAssets
    });

  } catch (err) {
    console.error("A critical error occurred while fetching games:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

app.get("/groups/:identifier", async (req, res) => {
    try {
        const { identifier } = req.params;
        let userId;
        let username;

        if (/^\d+$/.test(identifier)) {
            userId = identifier;
            const userResponse = await robustFetch(`https://users.roblox.com/v1/users/${userId}`);
            if (userResponse) {
                username = userResponse.name;
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

        let ownedGroups = [];
        try {
            ownedGroups = await getOwnedGroups(userId);
        } catch (err) {
            console.error("Failed to fetch owned groups:", err.message);
        }

        const groupsWithGames = [];
        for (const group of ownedGroups) {
            try {
                const games = await getGroupGames(group.id);
                groupsWithGames.push({
                    ...group,
                    games: games.map(game => ({
                      universeId: game.id,
                      placeId: game.rootPlace ? game.rootPlace.id : null,
                      name: game.name,
                      creator: game.creator,
                      placeVisits: game.placeVisits,
                      iconUrl: `rbxthumb://type=GameIcon&id=${game.id}&w=150&h=150`,
                      thumbnailUrl: `rbxthumb://type=GameThumbnail&id=${placeId}&w=768&h=432`
                    }))
                });
                await delay(250);
            } catch (groupError) {
                console.error(`Failed to fetch games for group ${group.id} (${group.name}). Error:`, groupError.message);
                groupsWithGames.push({ ...group, games: [] });
            }
        }

        res.json({
            username: username,
            userId: userId,
            groups: groupsWithGames
        });

    } catch (err) {
        console.error("A critical error occurred while fetching group data:", err);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

app.get("/all-groups/:identifier", async (req, res) => {
    try {
        const { identifier } = req.params;
        let userId;
        let username;

        if (/^\d+$/.test(identifier)) {
            userId = identifier;
            const userResponse = await robustFetch(`https://users.roblox.com/v1/users/${userId}`);
            if (userResponse) {
                username = userResponse.name;
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

        let allGroups = [];
        try {
            allGroups = await getAllUserGroups(userId);
        } catch (err) {
            console.error("Failed to fetch all user groups:", err.message);
        }

        const groupsWithGames = [];
        for (const group of allGroups) {
            try {
                const games = await getGroupGames(group.id);
                groupsWithGames.push({
                    ...group,
                    games: games.map(game => ({
                      universeId: game.id,
                      placeId: game.rootPlace ? game.rootPlace.id : null,
                      name: game.name,
                      creator: game.creator,
                      placeVisits: game.placeVisits,
                      iconUrl: `rbxthumb://type=GameIcon&id=${game.id}&w=150&h=150`,
                      thumbnailUrl: `rbxthumb://type=GameThumbnail&id=${placeId}&w=768&h=432`
                    }))
                });
                await delay(250);
            } catch (groupError) {
                console.error(`Failed to fetch games for group ${group.id} (${group.name}). Error:`, groupError.message);
                groupsWithGames.push({ ...group, games: [] });
            }
        }

        res.json({
            username: username,
            userId: userId,
            groups: groupsWithGames
        });

    } catch (err) {
        console.error("A critical error occurred while fetching all group data:", err);
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
      const userResponse = await robustFetch(`https://users.roblox.com/v1/users/${userId}`);
      if (userResponse) {
        username = userResponse.name;
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
    let allPasses = [];

    for (const game of profileGames) {
      try {
        const passes = await getGamePasses(game.id);
        if (passes.length > 0) {
            allPasses.push({
              gameName: game.name,
              universeId: game.id,
              passes: passes
            });
        }
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
      totalGamesWithPasses: allPasses.length,
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
