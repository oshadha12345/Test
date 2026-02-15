import mongoose from "mongoose";
import fs from "fs";

// MongoDB connection URI
const MONGO_URI = "mongodb+srv://oshiya444_db_user:r0etNWgYHdBiMuQf@cluster0.kehmkje.mongodb.net/?appName=Cluster0";

// connect MongoDB (FIXED)
mongoose.connect(MONGO_URI);

mongoose.connection.on("connected", () => {
    console.log("MongoDB connected");
});

mongoose.connection.on("error", (err) => {
    console.log("MongoDB error:", err);
});

// schema
const sessionSchema = new mongoose.Schema({
    fileName: {
        type: String,
        required: true,
        unique: true
    },
    data: Buffer
}, {
    timestamps: true
});

const Session = mongoose.model("Session", sessionSchema);


// ======================================
// upload function
// ======================================

export const upload = async (filePath, fileName) => {

    try {

        const buffer = fs.readFileSync(filePath);

        await Session.deleteOne({ fileName });

        await Session.create({
            fileName,
            data: buffer
        });

        console.log("Session saved to MongoDB");

        return "mongodb_saved";

    } catch (err) {

        console.log(err);
        throw err;

    }

};


// ======================================
// download function
// ======================================

export const download = async (fileName) => {

    try {

        const session = await Session.findOne({ fileName });

        if (!session) {

            console.log("No session found in MongoDB");
            return null;

        }

        console.log("Session loaded from MongoDB");

        return session.data;

    } catch (err) {

        console.log(err);
        throw err;

    }

};
