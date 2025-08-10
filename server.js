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

// Fetches games created by the user directly
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

// Fetches all groups a user is in and filters for owned groups.
async function getOwnedGroups(userId) {
    let ownedGroups = [];
    let cursor = "";
    do {
        const res = await fetch(`https://groups.roblox.com/v2/users/${userId}/groups/roles?cursor=${cursor}&limit=100&sortOrder=Asc`);
        const data = await res.json();
        if (data.data) {
            data.data.forEach(item => {
                if (item.role.name === 'Owner') {
                    ownedGroups.push(item.group);
                }
            });
        }
        cursor = data.nextPageCursor || "";
    } while (cursor);
    return ownedGroups;
}

// **FIXED**: This function now uses the correct 'develop' API to get all group games.
async function getGroupGames(groupId, groupName) {
    let games = [];
    let cursor = "";
    do {
        const res = await fetch(`https://develop.roblox.com/v1/groups/${groupId}/universes?sortOrder=Asc&limit=50&cursor=${cursor}`);
        const data = await res.json();
        if (data.data) {
            // Map the universe data to the same structure as user games
            games = games.concat(data.data.map(universe => ({
                id: universe.id,
                name: universe.name,
                rootPlace: { id: universe.rootPlaceId },
                creator: { type: "Group", id: groupId, name: groupName },
                placeVisits: universe.visits
            })));
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

    // Fetch both profile and group games, now with error handling
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
            // Pass both group ID and name to the updated function
            const groupGames = await getGroupGames(group.id, group.name);
            allGroupGames = allGroupGames.concat(groupGames);
            await delay(100); // Add a small delay to be safe
        } catch (groupError) {
            console.error(`Failed to fetch games for group ${group.id} (${group.name}). Error:`, groupError.message);
            // Continue to the next group without crashing
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
      ownedGroups: ownedGroups, // Also return the list of owned groups
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
            // Pass both group ID and name to the updated function
            const groupGames = await getGroupGames(group.id, group.name);
            allGroupGames = allGroupGames.concat(groupGames);
            await delay(100);
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
