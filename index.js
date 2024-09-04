const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const { google } = require('googleapis');
const passport = require('passport');
const { OIDCStrategy } = require('passport-azure-ad');
const cookieParser = require('cookie-parser');
const session = require('express-session');
require('dotenv').config();

const app = express();
const port = 3000;

// Configure EJS
app.set('view engine', 'ejs');

// Middleware
app.use(express.static('public'));
app.use(cookieParser());
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false } // Set to true if using HTTPS
}));

// Google OAuth2
const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.CALLBACK_URL
);

const SCOPES = ['https://www.googleapis.com/auth/calendar'];

// Microsoft OAuth2
passport.use(new OIDCStrategy({
    identityMetadata: `https://login.microsoftonline.com/${process.env.TENANT_ID}/v2.0/.well-known/openid-configuration`,
    clientID: process.env.MICROSOFT_CLIENT_ID,
    clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
    responseType: 'code',
    responseMode: 'query',
    redirectUrl: process.env.CALLBACK_URL_MICROSOFT,
    allowHttpForRedirectUrl: true,
    passReqToCallback: false,
    scope: ['profile', 'email'],
    loggingLevel: 'info'
}, (iss, sub, profile, accessToken, refreshToken, done) => {
    return done(null, profile);
}));

passport.serializeUser((user, done) => {
    done(null, user);
});

passport.deserializeUser((obj, done) => {
    done(null, obj);
});

app.use(passport.initialize());
app.use(passport.session());

// Routes
app.get('/', (req, res) => {
    res.render('login');
});

app.get('/login', (req, res) => {
    res.render('login');
});

app.get('/auth/google', (req, res) => {
    const url = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES,
    });
    res.redirect(url);
});

app.get('/auth/google/callback', async (req, res) => {
    try {
        const { tokens } = await oauth2Client.getToken(req.query.code);
        oauth2Client.setCredentials(tokens);
        req.session.tokens = tokens;
        res.redirect('/schedule');
    } catch (error) {
        console.error('Error during Google authentication callback:', error);
        res.redirect('/login');
    }
});

app.get('/auth/microsoft', passport.authenticate('azuread-openidconnect', {
    failureRedirect: '/login',
    session: false
}));

app.get('/auth/microsoft/callback', passport.authenticate('azuread-openidconnect', {
    failureRedirect: '/login',
    session: false
}), (req, res) => {
    req.session.user = req.user;
    res.redirect('/schedule');
});

app.get('/schedule', async (req, res) => {
    try {
        if (!req.session.tokens && !req.session.user) {
            return res.redirect('/login');
        }

        if (req.session.tokens) {
            oauth2Client.setCredentials(req.session.tokens);

            const response = await axios.get('https://portal.huflit.edu.vn/Home/Schedules', {
                headers: {
                    'User-Agent': 'Mozilla/5.0',
                    'Cookie': 'ASP.NET_SessionId=w0vxlriqq4fstfeavvaju3nj'
                }
            });

            const $ = cheerio.load(response.data);
            let scheduleData = [];

            $('#divThoiKhoaBieu .MainTb tr').each((i, row) => {
                let cells = $(row).find('td');
                if (cells.length > 0) {
                    let course = {
                        date: $(cells[0]).text(),
                        time: $(cells[1]).text(),
                        subject: $(cells[2]).text(),
                        location: $(cells[3]).text()
                    };
                    scheduleData.push(course);
                }
            });

            const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

            for (let event of scheduleData) {
                await calendar.events.insert({
                    calendarId: 'primary',
                    resource: {
                        summary: event.subject,
                        location: event.location,
                        start: {
                            dateTime: new Date(event.date + ' ' + event.time),
                            timeZone: 'Asia/Ho_Chi_Minh',
                        },
                        end: {
                            dateTime: new Date(new Date(event.date + ' ' + event.time).getTime() + 60 * 60 * 1000), // Example: 1 hour later
                            timeZone: 'Asia/Ho_Chi_Minh',
                        }
                    }
                });
            }

            res.render('index', { scheduleData });
        } else {
            // Handle scheduling logic for Microsoft authentication if needed
            res.render('index', { scheduleData: [] });
        }
    } catch (error) {
        console.error('Error retrieving schedule or syncing with Google Calendar:', error);
        res.status(500).send('An error occurred');
    }
});

app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});
