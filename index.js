const express = require('express');
const app = express()
const port = 5000
require('dotenv').config();

const cors = require('cors');
app.use(cors());
app.use(express.json());

const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

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

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();
    // Send a ping to confirm a successful connection
    const database = client.db("life_share");
    const donationCollection = database.collection("donation_requests");
    // const donationRequests=database.collection("donation_requests");
    // old = donationRequests

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

    app.post("/api/donation_requests", async (req, res) => {
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