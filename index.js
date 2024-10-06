const express = require('express');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 5000; // Use environment port or default to 3000

// GitHub API and Config
const BASE_URL = 'https://api.github.com/users';
const GITHUB_TOKEN = 'YOUR_GITHUB_TOKEN'; // Replace with your GitHub token
const PER_PAGE = 100;
const PROGRESS_FILE = 'fetch_progress.json';
const BATCH_SIZE = 1000; // Adjust as needed
const ERROR_BATCH_SIZE = 100; // Adjust as needed
let requestCount = 0;

// Middleware to serve static files (HTML, CSS)
app.use(express.static(path.join(__dirname, 'public'))); // Ensure this points to your 'public' folder

// Load Progress
function loadProgress() {
    if (fs.existsSync(PROGRESS_FILE)) {
        return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
    }
    return { since: 0, totalFetched: 0 };
}

// Save Progress
function saveProgress(progress) {
    fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
}

// Get Rate Limit
async function getRateLimit() {
    const response = await axios.get('https://api.github.com/rate_limit', {
        headers: { 'Authorization': `token ${GITHUB_TOKEN}` }
    });
    return response.data.resources.core;
}

// Fetch Users
async function getGitHubUsers(since) {
    const response = await axios.get(BASE_URL, {
        headers: { 'Authorization': `token ${GITHUB_TOKEN}` },
        params: { since, per_page: PER_PAGE }
    });
    requestCount++;
    return response.data;
}

// Fetch User Details with Error Handling
async function getUserDetails(username) {
    try {
        const response = await axios.get(`${BASE_URL}/${username}`, {
            headers: { 'Authorization': `token ${GITHUB_TOKEN}` }
        });
        requestCount++;
        return response.data;
    } catch (error) {
        console.error(`Error fetching details for user ${username}:`, error.response ? error.response.data : error.message);
        return null;
    }
}

// Save user data to file in hourly folders
function saveUserBatch(batch, totalFetched) {
    const hourFolder = path.join(__dirname, 'userdata');
    if (!fs.existsSync(hourFolder)) fs.mkdirSync(hourFolder, { recursive: true });

    const filePath = path.join(hourFolder, `github_users_${totalFetched}.json`);
    fs.writeFileSync(filePath, JSON.stringify(batch, null, 2));
    console.log(`Saved ${batch.length} users to ${filePath}`);
}

// Save skipped users to an error folder
function saveErrorBatch(errorBatch) {
    const errorFolder = path.join(__dirname, 'userdata', 'errorfolder');
    if (!fs.existsSync(errorFolder)) fs.mkdirSync(errorFolder, { recursive: true });

    const errorFilePath = path.join(errorFolder, `skipped_users_${Date.now()}.json`);
    fs.writeFileSync(errorFilePath, JSON.stringify(errorBatch, null, 2));
    console.log(`Saved ${errorBatch.length} skipped users to ${errorFilePath}`);
}

// Process All Users
async function fetchAllUsers() {
    let { since, totalFetched } = loadProgress();
    let allUsers = [];
    let errorBatch = []; // For skipped users

    while (true) {
        const rateLimit = await getRateLimit();
        if (rateLimit.remaining <= 1) {
            const waitTime = new Date(rateLimit.reset * 1000) - Date.now();
            console.log(`Rate limit reached. Waiting ${waitTime / 60000} minutes...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
            requestCount = 0;
        }

        const users = await getGitHubUsers(since);
        if (users.length === 0) break;

        for (const user of users) {
            const details = await getUserDetails(user.login);
            if (details) {
                allUsers.push({
                    sl: totalFetched,
                    since: since,
                    id: details.id,
                    username: details.login,
                    name: details.name,
                    email: details.email,
                    bio: details.bio,
                    location: details.location,
                    blog: details.blog,
                    company: details.company,
                    public_repos: details.public_repos,
                    followers: details.followers,
                    following: details.following,
                    created_at: details.created_at,
                });
                totalFetched++;
                console.log(`Fetched ${totalFetched}: ${details.login}`);
            } else {
                errorBatch.push({
                    username: user.login,
                    id: user.id,
                    reason: 'Missing or incomplete information'
                });
                console.log(`Skipping user ${user.login} due to missing information.`);
            }
        }

        since = users[users.length - 1].id;
        saveProgress({ since, totalFetched });

        if (allUsers.length >= BATCH_SIZE) {
            saveUserBatch(allUsers, totalFetched);
            allUsers = [];
        }

        if (errorBatch.length >= ERROR_BATCH_SIZE) {
            saveErrorBatch(errorBatch);
            errorBatch = [];
        }

        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    if (allUsers.length > 0) {
        saveUserBatch(allUsers, totalFetched);
    }

    if (errorBatch.length > 0) {
        saveErrorBatch(errorBatch);
    }

    console.log('Finished fetching all users.');
}

// Route for the button click to trigger the fetch process
app.get('/fetch-users', async (req, res) => {
    try {
        await fetchAllUsers();
        res.status(200).send('GitHub users fetched successfully.');
    } catch (error) {
        console.error('Error during fetching process:', error);
        res.status(500).send('Error fetching GitHub users.');
    }
});

// Route to get the status of fetching
app.get('/status', (req, res) => {
    const { since, totalFetched } = loadProgress();
    const userdataDir = path.join(__dirname, 'userdata');
    let batchFiles = [];
    if (fs.existsSync(userdataDir)) {
        batchFiles = fs.readdirSync(userdataDir).filter(file => file.endsWith('.json'));
    }

    res.json({
        since,
        totalFetched,
        batchFiles
    });
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
