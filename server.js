const express = require("express");
const fetch = require("node-fetch");
const cors = require("cors");
const NodeCache = require("node-cache");

const app = express();
const PORT = process.env.PORT || 3000;

const ROBLOX_COOKIE = process.env.ROBLOSECURITY_COOKIE;

const corsOptions = {
    origin: 'https://d-kiarie.github.io',
    optionsSuccessStatus: 200
};

app.use(cors(corsOptions));
const cache = new NodeCache({ stdTTL: 300 }); // 5 minute cache for all keys

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
    const cacheKey = `user-id-${username.toLowerCase()}`;
    if (cache.has(cacheKey)) return cache.get(cacheKey);

    const url = `https://users.roblox.com/v1/usernames/users`;
    const data = await robustFetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ usernames: [username], excludeBannedUsers: true })
    });
    if (data && data.data && data.data.length > 0) {
        const userId = data.data[0].id;
        cache.set(cacheKey, userId);
        return userId;
    }
    return null;
}

async function getProfileGames(userId) {
    const cacheKey = `profile-games-${userId}`;
    if (cache.has(cacheKey)) return cache.get(cacheKey);

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

    cache.set(cacheKey, games);
    return games;
}

async function getGroupRoles(groupId) {
    const cacheKey = `group-roles-${groupId}`;
    if (cache.has(cacheKey)) {
        return cache.get(cacheKey);
    }
    const url = `https://groups.roblox.com/v1/groups/${groupId}/roles`;
    try {
        const data = await robustFetch(url);
        if (data && data.roles) {
            cache.set(cacheKey, data.roles);
            return data.roles;
        }
        return [];
    } catch (error) {
        console.error(`Failed to fetch roles for group ${groupId}:`, error.message);
        return [];
    }
}

async function getOwnedGroups(userId) {
    const cacheKey = `owned-groups-top-two-${userId}`;
    if (cache.has(cacheKey)) return cache.get(cacheKey);

    const url = `https://groups.roblox.com/v1/users/${userId}/groups/roles`;
    const userRolesData = await robustFetch(url);
    
    if (userRolesData && userRolesData.data) {
        const promises = userRolesData.data.map(async (item) => {
            const allGroupRoles = await getGroupRoles(item.group.id);
            if (allGroupRoles && allGroupRoles.length > 0) {
                allGroupRoles.sort((a, b) => b.rank - a.rank);
                const userRank = item.role.rank;
                const topRank = allGroupRoles[0].rank;
                const secondTopRank = allGroupRoles.length > 1 ? allGroupRoles[1].rank : null;

                if (userRank === topRank || (secondTopRank !== null && userRank === secondTopRank)) {
                    return item.group;
                }
            }
            return null;
        });

        const results = (await Promise.all(promises)).filter(group => group !== null);
        cache.set(cacheKey, results);
        return results;
    }
    return [];
}


async function getAllUserGroups(userId) {
    const cacheKey = `all-groups-${userId}`;
    if (cache.has(cacheKey)) return cache.get(cacheKey);

    const url = `https://groups.roblox.com/v1/users/${userId}/groups/roles`;
    const data = await robustFetch(url);
    let allGroups = [];
    if (data && data.data) {
        allGroups = data.data.map(item => item.group);
    }
    cache.set(cacheKey, allGroups);
    return allGroups;
}

async function getGroupGames(groupId) {
    const cacheKey = `group-games-${groupId}`;
    if (cache.has(cacheKey)) return cache.get(cacheKey);

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

    cache.set(cacheKey, games);
    return games;
}

async function getGamePasses(universeId) {
    const cacheKey = `game-passes-${universeId}`;
    if (cache.has(cacheKey)) return cache.get(cacheKey);

    let passes = [];
    let cursor = "";
    do {
        const url = `https://games.roblox.com/v1/games/${universeId}/game-passes?limit=100&sortOrder=Asc&cursor=${cursor}`;
        const data = await robustFetch(url);
        if (data && data.data) passes = passes.concat(data.data);
        cursor = data ? data.nextPageCursor : "";
    } while (cursor);

    cache.set(cacheKey, passes);
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
            username = userResponse ? userResponse.name : null;
        } else {
            username = identifier;
            userId = await getUserId(username);
        }

        if (!userId) {
            return res.status(404).json({ error: `User "${identifier}" not found.` });
        }

        const [profileGames, ownedGroups] = await Promise.all([
            getProfileGames(userId),
            getOwnedGroups(userId)
        ]);
        
        const groupGamesPromises = ownedGroups.map(group => getGroupGames(group.id));
        const allGroupGamesArrays = await Promise.all(groupGamesPromises);
        const allGroupGames = [].concat(...allGroupGamesArrays);

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
            username = userResponse ? userResponse.name : null;
        } else {
            username = identifier;
            userId = await getUserId(username);
        }

        if (!userId) {
            return res.status(404).json({ error: `User "${identifier}" not found.` });
        }

        const ownedGroups = await getOwnedGroups(userId);
        
        const groupsWithGamesPromises = ownedGroups.map(async (group) => {
            const games = await getGroupGames(group.id);
            return {
                ...group,
                games: games.map(game => ({
                    universeId: game.id,
                    placeId: game.rootPlace ? game.rootPlace.id : null,
                    name: game.name,
                    creator: game.creator,
                    placeVisits: game.placeVisits,
                    iconUrl: `rbxthumb://type=GameIcon&id=${game.id}&w=150&h=150`,
                    thumbnailUrl: game.rootPlace ? `rbxthumb://type=GameThumbnail&id=${game.rootPlace.id}&w=768&h=432` : null
                }))
            };
        });

        const groupsWithGames = await Promise.all(groupsWithGamesPromises);

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
            username = userResponse ? userResponse.name : null;
        } else {
            username = identifier;
            userId = await getUserId(username);
        }

        if (!userId) {
            return res.status(404).json({ error: `User "${identifier}" not found.` });
        }

        const allGroups = await getAllUserGroups(userId);
        
        const groupsWithGamesPromises = allGroups.map(async (group) => {
            const games = await getGroupGames(group.id);
            return {
                ...group,
                games: games.map(game => ({
                    universeId: game.id,
                    placeId: game.rootPlace ? game.rootPlace.id : null,
                    name: game.name,
                    creator: game.creator,
                    placeVisits: game.placeVisits,
                    iconUrl: `rbxthumb://type=GameIcon&id=${game.id}&w=150&h=150`,
                    thumbnailUrl: game.rootPlace ? `rbxthumb://type=GameThumbnail&id=${game.rootPlace.id}&w=768&h=432` : null
                }))
            };
        });

        const groupsWithGames = await Promise.all(groupsWithGamesPromises);

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
            username = userResponse ? userResponse.name : null;
        } else {
            username = identifier;
            userId = await getUserId(username);
        }

        if (!userId) {
            return res.status(404).json({ error: `User "${identifier}" not found.` });
        }

        const profileGames = await getProfileGames(userId);
        
        const passesPromises = profileGames.map(async (game) => {
            const passes = await getGamePasses(game.id);
            if (passes.length > 0) {
                return {
                    gameName: game.name,
                    universeId: game.id,
                    passes: passes
                };
            }
            return null;
        });

        const allPasses = (await Promise.all(passesPromises)).filter(p => p !== null);

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
