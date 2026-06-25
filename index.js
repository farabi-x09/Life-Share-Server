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





// Create a MongoClient with a MongoClientOptions object to set the Stable API version
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
    console.log(token);

    // console.log("payload", payload);
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
    // Connect the client to the server	(optional starting in v4.7)
    // await client.connect();
    // Send a ping to confirm a successful connection
    const database = client.db("life_share");
    const donationCollection = database.collection("donation_requests");
    const fundsCollection = database.collection("funds");
    const usersCollection = database.collection("user");

// 💡 ১. সব ইউজার পাওয়ার API
    app.get("/api/users", async (req, res) => {
      try {
        const users = await usersCollection.find().toArray();
        res.send(users);
      } catch (error) {
        console.error("Error fetching users:", error);
        res.status(500).send({ message: "Internal Server Error" });
      }
    });

    // 💡 ২. ইউজারের রোল (Role) বা স্ট্যাটাস আপডেট করার API
    app.patch('/api/users/:id', async (req, res) => {
      try {
        const id = req.params.id;
        const { role, status } = req.body; 
        
        const query = { _id: new ObjectId(id) };
        const updateDoc = { $set: {} };
        
        // ফ্রন্টএন্ড থেকে যা পাঠানো হবে, শুধু সেটাই আপডেট হবে
        if(role) updateDoc.$set.role = role;
        if(status) updateDoc.$set.status = status;

        const result = await usersCollection.updateOne(query, updateDoc);
        res.send(result);
      } catch (error) {
        console.error("Error updating user:", error);
        res.status(500).send({ message: "Internal Server Error" });
      }
    });






    // ফান্ডিং পেজে সব ডাটা দেখানোর জন্য GET API
    app.get("/api/funds", async (req, res) => {
      try {
        // সব ফান্ডিং ডাটা নিয়ে আসা এবং সর্বশেষ ফান্ডিং আগে দেখানোর জন্য sort করা (-1)
        const funds = await fundsCollection.find().sort({ date: -1 }).toArray();
        res.send(funds);
      } catch (error) {
        console.error("Error fetching funds:", error);
        res.status(500).send({ message: "Internal Server Error" });
      }
    });

    app.post("/api/funds", async (req, res) => {
      const {productId,title,price,userEmail,sessionId,
        userId,
        PriceId,date,userName} = req.body;

      const isExist = await fundsCollection.findOne({ sessionId })
      if(isExist){
        return res.json({msg: "Funding already exists"})
      }

      await fundsCollection.insertOne({
        sessionId,
        userId,
        PriceId,
        title,price,userEmail,productId,date,userName
      });
      res.json({msg: "Funding successfully"})
    });
   

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

    // Get a single donation request
    app.get("/api/donation_requests/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await donationCollection.findOne(query);
      res.send(result);
    });

    app.post("/api/donation_requests",verifyToken, async (req, res) => {
      const donationRequest = req.body;
      const result = await donationCollection.insertOne(donationRequest);
      res.send(result);
    });




// রিকোয়েস্টের স্ট্যাটাস আপডেট করার API
app.patch('/api/donation_requests/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const updateData = req.body; // 💡 ফ্রন্টএন্ড থেকে যা যা পাঠাবে, পুরোটাই এখানে রিসিভ হবে

    const query = { _id: new ObjectId(id) };
    const updateDoc = {
      $set: updateData, // 💡 এখন শুধু পাঠানো ডাটাটাই আপডেট হবে, আগের ডাটা মুছে যাবে না!
    };

    const result = await donationCollection.updateOne(query, updateDoc);
    res.send(result);
  } catch (error) {
    console.error("Error updating donation:", error);
    res.status(500).send({ message: "Internal Server Error" });
  }
});



// রিকোয়েস্ট ডিলিট করার API
app.delete('/api/donation_requests/:id', async (req, res) => {
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




    // await client.db("admin").command({ ping: 1 });
    // console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);




app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})