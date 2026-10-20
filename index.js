

const express = require('express');
const app = express()
const port = 5000
require('dotenv').config();

const cors = require('cors');
app.use(cors());
app.use(express.json());

const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const { createRemoteJWKSet, jwtVerify } = require('jose-cjs');

app.get('/', (req, res) => {
  res.send('Hello World!')
})

const uri = process.env.MONGO_DB_URI;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

const JWKS = createRemoteJWKSet(
  new URL(`${process.env.CLIENT_URL}/api/auth/jwks`),
);

const verifyToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer")) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const token = authHeader.split(" ")[1];
  if (!token) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  try {
    const { payload } = await jwtVerify(token, JWKS);
    req.user = payload;
    next();
  } catch (error) {
    console.log(error);
    return res
      .status(401)
      .json({
        message: error.message || "Unauthorized: Invalid or expired token",
      });
  }
};

async function run() {
  try {
    const database = client.db("life_share");
    const donationCollection = database.collection("donation_requests");
    const fundsCollection = database.collection("funds");
    const usersCollection = database.collection("user");

    // ---------- মিডলওয়্যার: অ্যাডমিন ও ভেরিফাইড চেক ----------

    // শুধু অ্যাডমিন ঢুকতে পারবে
    const verifyAdmin = async (req, res, next) => {
      try {
        const user = await usersCollection.findOne({ email: req.user.email });
        if (user?.role !== "admin") {
          return res.status(403).json({ message: "Forbidden: admins only" });
        }
        next();
      } catch (error) {
        res.status(500).json({ message: "Internal Server Error" });
      }
    };

    // শুধু ভেরিফাইড ডোনার (অথবা অ্যাডমিন) ঢুকতে পারবে
    const verifyVerifiedDonor = async (req, res, next) => {
      try {
        const user = await usersCollection.findOne({ email: req.user.email });
        if (!user) return res.status(404).json({ message: "User not found" });
        if (user.status === "blocked") {
          return res.status(403).json({ message: "Your account is blocked" });
        }
        if (user.role !== "admin" && user.verificationStatus !== "verified") {
          return res.status(403).json({ message: "Your account is not verified yet" });
        }
        next();
      } catch (error) {
        res.status(500).json({ message: "Internal Server Error" });
      }
    };

    // ---------- USERS ----------
    app.get("/api/users", verifyToken, verifyAdmin, async (req, res) => {
      try {
        const users = await usersCollection.find().toArray();
        res.send(users);
      } catch (error) {
        console.error("Error fetching users:", error);
        res.status(500).send({ message: "Internal Server Error" });
      }
    });

    // লগইন করা ইউজার নিজের ভেরিফিকেশন স্ট্যাটাস দেখতে পারবে
    app.get("/api/users/me", verifyToken, async (req, res) => {
      try {
        const user = await usersCollection.findOne(
          { email: req.user.email },
          { projection: { role: 1, status: 1, verificationStatus: 1 } }
        );
        res.send(user);
      } catch (error) {
        res.status(500).send({ message: "Internal Server Error" });
      }
    });

    // সার্চ পেজের জন্য পাবলিক route (লগইন লাগবে না)
    // শুধু ভেরিফাইড ও অ্যাক্টিভ ডোনার আসবে, ইমেইল বা সার্টিফিকেট যাবে না
    app.get("/api/donors", async (req, res) => {
      try {
        const { bloodGroup, district, upazila } = req.query;

        const query = {
          verificationStatus: "verified",
          status: { $ne: "blocked" },
        };
        if (bloodGroup && bloodGroup !== "all") query.bloodGroup = bloodGroup;
        if (district && district !== "all") query.district = district;
        if (upazila && upazila !== "all") query.upazila = upazila;

        const donors = await usersCollection
          .find(query, {
            projection: { name: 1, image: 1, bloodGroup: 1, district: 1, upazila: 1 },
          })
          .toArray();

        res.send(donors);
      } catch (error) {
        console.error("Error fetching donors:", error);
        res.status(500).send({ message: "Internal Server Error" });
      }
    });

    app.patch('/api/users/:id', verifyToken, verifyAdmin, async (req, res) => {
      try {
        const id = req.params.id;
        const { role, status } = req.body;

        const query = { _id: new ObjectId(id) };
        const updateDoc = { $set: {} };

        if (role) updateDoc.$set.role = role;
        if (status) updateDoc.$set.status = status;

        const result = await usersCollection.updateOne(query, updateDoc);
        res.send(result);
      } catch (error) {
        console.error("Error updating user:", error);
        res.status(500).send({ message: "Internal Server Error" });
      }
    });

    // সার্টিফিকেট approve / reject
    app.patch('/api/users/:id/verification', verifyToken, verifyAdmin, async (req, res) => {
      try {
        const { verificationStatus } = req.body;
        if (!["verified", "rejected", "pending"].includes(verificationStatus)) {
          return res.status(400).send({ message: "Invalid verification status" });
        }
        const result = await usersCollection.updateOne(
          { _id: new ObjectId(req.params.id) },
          { $set: { verificationStatus } }
        );
        res.send(result);
      } catch (error) {
        console.error("Error updating verification:", error);
        res.status(500).send({ message: "Internal Server Error" });
      }
    });

    // ---------- FUNDS ----------
    app.get("/api/funds", async (req, res) => {
      try {
        const funds = await fundsCollection.find().sort({ date: -1 }).toArray();
        res.send(funds);
      } catch (error) {
        console.error("Error fetching funds:", error);
        res.status(500).send({ message: "Internal Server Error" });
      }
    });

    // NEW: ফান্ডিং পেজের জন্য পাবলিক route
    // নাম, ছবি ও তারিখ যাবে। টাকা বা ইমেইল যাবে না।
    app.get("/api/funds/public", async (req, res) => {
      try {
        const funds = await fundsCollection
          .find({}, { projection: { userName: 1, userEmail: 1, date: 1 } })
          .sort({ date: -1 })
          .toArray();

        const emails = [...new Set(funds.map((f) => f.userEmail).filter(Boolean))];
        const users = await usersCollection
          .find({ email: { $in: emails } }, { projection: { email: 1, image: 1, name: 1 } })
          .toArray();

        const userByEmail = Object.fromEntries(users.map((u) => [u.email, u]));

        const result = funds.map((f) => {
          const u = userByEmail[f.userEmail];
          return {
            _id: f._id,
            // পেমেন্টে নাম "undefined" সেভ হলে ইউজারের আসল নাম ব্যবহার হবে
            userName: f.userName && f.userName !== "undefined" ? f.userName : u?.name || null,
            image: u?.image || null,
            date: f.date,
          };
        });

        res.send(result);
      } catch (error) {
        console.error("Error fetching public funds:", error);
        res.status(500).send({ message: "Internal Server Error" });
      }
    });

    app.post("/api/funds", async (req, res) => {
      const { productId, title, price, userEmail, sessionId,
        userId, PriceId, date, userName } = req.body;

      const isExist = await fundsCollection.findOne({ sessionId })
      if (isExist) {
        return res.json({ msg: "Funding already exists" })
      }

      await fundsCollection.insertOne({
        sessionId, userId, PriceId,
        title, price, userEmail, productId, date, userName
      });
      res.json({ msg: "Funding successfully" })
    });

    // ---------- DONATION REQUESTS ----------
    app.get("/api/donation_requests", async (req, res) => {
      const query = {};
      if (req.query.requesterEmail) {
        query.requesterEmail = req.query.requesterEmail;
      }
      if (req.query.status) {
        query.status = req.query.status;
      }
      const cursor = donationCollection.find(query);
      const result = await cursor.toArray();
      res.send(result);
    })

    app.get("/api/donation_requests/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await donationCollection.findOne(query);
      res.send(result);
    });

    // শুধু ভেরিফাইড ডোনার রিকুয়েস্ট তৈরি করতে পারবে
    app.post("/api/donation_requests", verifyToken, verifyVerifiedDonor, async (req, res) => {
      const donationRequest = req.body;
      const result = await donationCollection.insertOne(donationRequest);
      res.send(result);
    });

    // শুধু ভেরিফাইড ডোনার রিকুয়েস্ট accept (donate) করতে পারবে
    app.patch("/api/donation_requests/:id/accept", verifyToken, verifyVerifiedDonor, async (req, res) => {
      try {
        const id = req.params.id;
        const donor = await usersCollection.findOne({ email: req.user.email });
        const request = await donationCollection.findOne({ _id: new ObjectId(id) });

        if (!request) {
          return res.status(404).send({ message: "Request not found" });
        }
        if (request.status !== "pending") {
          return res.status(400).send({ message: "This request is no longer available" });
        }
        if (request.requesterEmail === donor.email) {
          return res.status(400).send({ message: "You cannot donate to your own request" });
        }

        const result = await donationCollection.updateOne(
          { _id: new ObjectId(id), status: "pending" },
          {
            $set: {
              status: "inprogress",
              donorName: donor.name,   // ডাটাবেস থেকে নেওয়া হচ্ছে, ব্রাউজার থেকে নয়
              donorEmail: donor.email,
            },
          }
        );
        res.send(result);
      } catch (error) {
        console.error("Error accepting request:", error);
        res.status(500).send({ message: "Internal Server Error" });
      }
    });

    // টোকেন + ভেরিফাইড লাগবে
    app.patch('/api/donation_requests/:id', verifyToken, verifyVerifiedDonor, async (req, res) => {
      try {
        const id = req.params.id;
        const updateData = req.body;
        const query = { _id: new ObjectId(id) };
        const updateDoc = { $set: updateData };
        const result = await donationCollection.updateOne(query, updateDoc);
        res.send(result);
      } catch (error) {
        console.error("Error updating donation:", error);
        res.status(500).send({ message: "Internal Server Error" });
      }
    });

    // শুধু অ্যাডমিন ডিলিট করতে পারবে
    app.delete('/api/donation_requests/:id', verifyToken, verifyAdmin, async (req, res) => {
      try {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const result = await donationCollection.deleteOne(query);
        res.send(result);
      } catch (error) {
        console.error("Error deleting donation:", error);
        res.status(500).send({ message: "Internal Server Error" });
      }
    });

  } finally {
  }
}
run().catch(console.dir);

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})