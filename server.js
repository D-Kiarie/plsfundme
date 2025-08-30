const express = require("express");
const fetch = require("node-fetch");
const cors = require("cors");
const NodeCache = require("node-cache");

const app = express();
const PORT = process.env.PORT || 3000;

const ROBLOX_COOKIE = process.env.ROBLOSECURITY_COOKIE;

// Initialize a cache with a 5-minute TTL (Time To Live) for each entry.
// This means data will be stored for 5 minutes before being fetched again.
const apiCache = new NodeCache({ stdTTL: 300 });

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
            
            // Handle rate limits (HTTP 429) by waiting and retrying
            if (res.status === 429) {
                console.warn(`Rate limit hit for ${url}. Retrying in ${delayMs * (i + 1)}ms...`);
                await delay(delayMs * (i + 1));
                continue;
            }

            if (res.status >= 400 && res.status < 500) {
                const errorText = await res.text();
                console.error(`Client error response for ${url}: ${errorText}`);
                throw new Error(`Client error: ${res.status}`);
            }

            console.warn(`Request to ${url} failed with status ${res.status}. Retrying...`);
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
    const cacheKey = `userId-${username}`;
    if (apiCache.has(cacheKey)) {
        return apiCache.get(cacheKey);
    }
    const url = `https://users.roblox.com/v1/usernames/users`;
    const data = await robustFetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ usernames: [username], excludeBannedUsers: true })
    });
    if (data && data.data && data.data.length > 0) {
        const userId = data.data[0].id;
        apiCache.set(cacheKey, userId);
        return userId;
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
        const cacheKey = `games-${identifier}`;
        if (apiCache.has(cacheKey)) {
            return res.json(apiCache.get(cacheKey));
        }

        let userId;
        let username;

        if (/^\d+$/.test(identifier)) {
            userId = identifier;
            const userResponse = await robustFetch(`https://users.roblox.com/v1/users/${userId}`);
            username = userResponse ? userResponse.name : null;
        } else {
            username = identifier;
            userId = await getUserId(username);
        }

        if (!userId || !username) {
            return res.status(404).json({ error: `User "${identifier}" not found.` });
        }

        const profileGames = await getProfileGames(userId);
        const ownedGroups = await getOwnedGroups(userId);

        // OPTIMIZATION: Fetch games for all groups concurrently
        const groupGamesPromises = ownedGroups.map(group => getGroupGames(group.id).catch(err => {
            console.error(`Failed to fetch games for group ${group.id}, continuing...`, err.message);
            return []; // Return empty array on error so Promise.all doesn't fail
        }));
        
        const allGroupGamesArrays = await Promise.all(groupGamesPromises);
        const allGroupGames = allGroupGamesArrays.flat(); // Flatten the array of arrays

        const allGames = profileGames.concat(allGroupGames);

        const gamesWithAssets = allGames.map(game => ({
            universeId: game.id,
            placeId: game.rootPlace ? game.rootPlace.id : null,
            name: game.name,
            creator: game.creator,
            placeVisits: game.placeVisits,
            iconUrl: `rbxthumb://type=GameIcon&id=${game.id}&w=150&h=150`,
            thumbnailUrl: game.rootPlace ? `rbxthumb://type=GameThumbnail&id=${game.rootPlace.id}&w=768&h=432` : null
        }));

        const responseData = {
            username: username,
            userId: userId,
            totalGames: allGames.length,
            ownedGroups: ownedGroups,
            games: gamesWithAssets
        };

        apiCache.set(cacheKey, responseData); // Save the final result to the cache
        res.json(responseData);

    } catch (err) {
        console.error("A critical error occurred while fetching games:", err);
        res.status(500).json({ error: "Internal Server Error" });
    }
});


app.get("/gamepasses/:identifier", async (req, res) => {
    try {
        const { identifier } = req.params;
        const cacheKey = `gamepasses-${identifier}`;
        if (apiCache.has(cacheKey)) {
            return res.json(apiCache.get(cacheKey));
        }

        let userId;
        let username;

        if (/^\d+$/.test(identifier)) {
            userId = identifier;
            const userResponse = await robustFetch(`https://users.roblox.com/v1/users/${userId}`);
            username = userResponse ? userResponse.name : null;
        } else {
            username = identifier;
            userId = await getUserId(username);
        }

        if (!userId || !username) {
            return res.status(404).json({ error: `User "${identifier}" not found.` });
        }

        const profileGames = await getProfileGames(userId);
        
        // OPTIMIZATION: Fetch game passes for all games concurrently
        const passesPromises = profileGames.map(game => 
            getGamePasses(game.id).then(passes => ({
                gameName: game.name,
                universeId: game.id,
                passes: passes
            })).catch(err => {
                console.error(`Failed to fetch passes for game ${game.id}, continuing...`, err.message);
                return { gameName: game.name, universeId: game.id, passes: [] }; // Return empty passes on error
            })
        );
        
        const allPassesResults = await Promise.all(passesPromises);
        const allPasses = allPassesResults.filter(g => g.passes.length > 0);

        const responseData = {
            username: username,
            userId: userId,
            totalGamesWithPasses: allPasses.length,
            totalPasses: allPasses.reduce((sum, g) => sum + g.passes.length, 0),
            games: allPasses
        };
        
        apiCache.set(cacheKey, responseData);
        res.json(responseData);

    } catch (err) {
        console.error("A critical error occurred while fetching game passes:", err);
        res.status(500).json({ error: "Internal Server Error" });
    }
});


app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
