import mongoose from "mongoose";

const MONGO_URI = process.env.MONGO_URI;

if (!global.mongoose) {
    global.mongoose = mongoose.connect(MONGO_URI);
}

const statsSchema = new mongoose.Schema({
    guilds: Number,
    users: Number,
    ping: Number,
    commands: Number,
    uptime: Number,
    updatedAt: Date
});

const Stats =
    mongoose.models.Stats ||
    mongoose.model("Stats", statsSchema);

export default async function handler(req, res) {
    try {
        await global.mongoose;

        const stats = await Stats.findOne();

        return res.status(200).json({
            success: true,
            stats
        });
    } catch (err) {
        console.error(err);

        return res.status(500).json({
            success: false,
            error: "Internal Server Error"
        });
    }
}