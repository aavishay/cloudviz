package anomaly

import (
	"math"
	"math/rand"
	"sort"
	"time"
)

// IsolationForest implements the Isolation Forest algorithm
// for unsupervised anomaly detection
type IsolationForest struct {
	trees      []*IsolationTree
	sampleSize int
	numTrees   int
	data       [][]float64
	threshold  float64
}

// IsolationTree represents a single tree in the forest
type IsolationTree struct {
	root      *TreeNode
	height    int
	numSamples int
}

// TreeNode represents a node in the isolation tree
type TreeNode struct {
	Left       *TreeNode
	Right      *TreeNode
	SplitAttr  int
	SplitValue float64
	Size       int
	IsLeaf     bool
}

// IsolationResult contains the results of isolation forest detection
type IsolationResult struct {
	IsAnomaly   bool
	Score       float64 // Anomaly score (0-1, higher = more anomalous)
	PathLength  float64 // Average path length
	ExpectedLength float64 // Expected path length for normal points
}

// NewIsolationForest creates a new Isolation Forest
// sampleSize: number of samples to use per tree (typically 256)
// numTrees: number of trees in forest (typically 100)
// threshold: score above which is considered anomaly (typically 0.5-0.6)
func NewIsolationForest(sampleSize, numTrees int, threshold float64) *IsolationForest {
	// Seed random
	rand.Seed(time.Now().UnixNano())

	return &IsolationForest{
		sampleSize: sampleSize,
		numTrees:   numTrees,
		threshold:  threshold,
	}
}

// Fit builds the isolation forest from training data
// data should be a slice of feature vectors
func (iforest *IsolationForest) Fit(data [][]float64) {
	if len(data) == 0 {
		return
	}

	iforest.data = data

	// Build trees
	iforest.trees = make([]*IsolationTree, iforest.numTrees)

	for i := 0; i < iforest.numTrees; i++ {
		// Sample data without replacement
		sample := sampleData(data, iforest.sampleSize)

		// Calculate tree height limit
		height := int(math.Ceil(math.Log2(float64(len(sample)))))

		// Build tree
		iforest.trees[i] = &IsolationTree{
			root:       buildTree(sample, 0, height),
			height:     height,
			numSamples: len(sample),
		}
	}
}

// sampleData randomly samples n items from data without replacement
func sampleData(data [][]float64, n int) [][]float64 {
	if n >= len(data) {
		// Make a copy
		result := make([][]float64, len(data))
		copy(result, data)
		return result
	}

	// Shuffle and take first n
	indices := rand.Perm(len(data))
	result := make([][]float64, n)
	for i := 0; i < n; i++ {
		result[i] = data[indices[i]]
	}
	return result
}

// buildTree recursively builds an isolation tree
func buildTree(data [][]float64, currentHeight, heightLimit int) *TreeNode {
	node := &TreeNode{
		Size: len(data),
	}

	// Terminal conditions
	if currentHeight >= heightLimit || len(data) <= 1 {
		node.IsLeaf = true
		return node
	}

	// Randomly select attribute
	numAttrs := len(data[0])
	attr := rand.Intn(numAttrs)
	node.SplitAttr = attr

	// Find min and max for selected attribute
	minVal, maxVal := data[0][attr], data[0][attr]
	for _, d := range data {
		if d[attr] < minVal {
			minVal = d[attr]
		}
		if d[attr] > maxVal {
			maxVal = d[attr]
		}
	}

	// If all values are the same, make it a leaf
	if minVal == maxVal {
		node.IsLeaf = true
		return node
	}

	// Randomly select split value between min and max
	node.SplitValue = minVal + rand.Float64()*(maxVal-minVal)

	// Split data
	var leftData, rightData [][]float64
	for _, d := range data {
		if d[attr] < node.SplitValue {
			leftData = append(leftData, d)
		} else {
			rightData = append(rightData, d)
		}
	}

	// Recursively build children
	if len(leftData) > 0 {
		node.Left = buildTree(leftData, currentHeight+1, heightLimit)
	}
	if len(rightData) > 0 {
		node.Right = buildTree(rightData, currentHeight+1, heightLimit)
	}

	return node
}

// pathLength calculates the path length for a point in a tree
func pathLength(node *TreeNode, point []float64, currentHeight int) float64 {
	if node == nil || node.IsLeaf {
		// Adjust for unbuilt subtrees
		return float64(currentHeight) + c(node.Size)
	}

	if point[node.SplitAttr] < node.SplitValue {
		if node.Left != nil {
			return pathLength(node.Left, point, currentHeight+1)
		}
		return float64(currentHeight + 1)
	}

	if node.Right != nil {
		return pathLength(node.Right, point, currentHeight+1)
	}
	return float64(currentHeight + 1)
}

// c calculates the average path length for unsuccessful search in binary tree
func c(n int) float64 {
	if n <= 1 {
		return 0
	}
	return 2*(harmonicNumber(n-1)) - float64(2*(n-1))/float64(n)
}

// harmonicNumber calculates the n-th harmonic number
func harmonicNumber(n int) float64 {
	sum := 0.0
	for i := 1; i <= n; i++ {
		sum += 1.0 / float64(i)
	}
	return sum
}

// AnomalyScore calculates the anomaly score for a point
// Score close to 1 indicates anomaly, close to 0 indicates normal
func (iforest *IsolationForest) AnomalyScore(point []float64) float64 {
	if len(iforest.trees) == 0 {
		return 0
	}

	// Calculate average path length across all trees
	var avgPathLength float64
	for _, tree := range iforest.trees {
		avgPathLength += pathLength(tree.root, point, 0)
	}
	avgPathLength /= float64(len(iforest.trees))

	// Calculate expected path length
	expectedLen := c(iforest.sampleSize)

	// Calculate anomaly score
	// s(x, n) = 2^(-E(h(x))/c(n))
	score := math.Pow(2, -avgPathLength/expectedLen)

	return score
}

// Detect checks if a point is anomalous
func (iforest *IsolationForest) Detect(point []float64) IsolationResult {
	score := iforest.AnomalyScore(point)

	// Calculate average path length for context
	var avgPathLength float64
	for _, tree := range iforest.trees {
		avgPathLength += pathLength(tree.root, point, 0)
	}
	avgPathLength /= float64(len(iforest.trees))

	return IsolationResult{
		IsAnomaly:      score >= iforest.threshold,
		Score:          score,
		PathLength:     avgPathLength,
		ExpectedLength: c(iforest.sampleSize),
	}
}

// DetectAll analyzes multiple points
func (iforest *IsolationForest) DetectAll(points [][]float64) []IsolationResult {
	results := make([]IsolationResult, len(points))
	for i, point := range points {
		results[i] = iforest.Detect(point)
	}
	return results
}

// IsolationForestForCosts creates an isolation forest configured for cost data
func IsolationForestForCosts(data []float64) *IsolationForest {
	// Convert 1D cost data to 2D feature vectors
	// Features: cost, change from previous, rolling average
	features := make([][]float64, len(data))

	// Calculate rolling average
	window := 7
	for i := 0; i < len(data); i++ {
		features[i] = make([]float64, 3)

		// Feature 1: normalized cost (log transform for scale invariance)
		if data[i] > 0 {
			features[i][0] = math.Log10(data[i])
		}

		// Feature 2: change from previous
		if i > 0 && data[i-1] > 0 {
			features[i][1] = (data[i] - data[i-1]) / data[i-1]
		}

		// Feature 3: rolling average deviation
		if i >= window {
			sum := 0.0
			for j := i - window + 1; j <= i; j++ {
				sum += data[j]
			}
			avg := sum / float64(window)
			if avg > 0 {
				features[i][2] = (data[i] - avg) / avg
			}
		}
	}

	// Create and fit forest
	forest := NewIsolationForest(256, 100, 0.6)
	forest.Fit(features)

	return forest
}

// DetectCostAnomalies finds anomalous costs using Isolation Forest
func DetectCostAnomalies(costs []float64, dates []time.Time) []IsolationResult {
	if len(costs) < 14 { // Need at least 2 weeks of data
		return nil
	}

	forest := IsolationForestForCosts(costs)
	if len(forest.trees) == 0 {
		return nil
	}

	// Build feature vectors for all points
	features := make([][]float64, len(costs))
	window := 7
	for i := 0; i < len(costs); i++ {
		features[i] = make([]float64, 3)

		if costs[i] > 0 {
			features[i][0] = math.Log10(costs[i])
		}

		if i > 0 && costs[i-1] > 0 {
			features[i][1] = (costs[i] - costs[i-1]) / costs[i-1]
		}

		if i >= window {
			sum := 0.0
			for j := i - window + 1; j <= i; j++ {
				sum += costs[j]
			}
			avg := sum / float64(window)
			if avg > 0 {
				features[i][2] = (costs[i] - avg) / avg
			}
		}
	}

	return forest.DetectAll(features)
}

// SimpleAnomalyDetector provides a simple interface for single-value anomaly detection
type SimpleAnomalyDetector struct {
	median    float64
	mad       float64
	mean      float64
	stddev    float64
	threshold float64
}

// NewSimpleAnomalyDetector creates a simple detector from historical data
func NewSimpleAnomalyDetector(values []float64, threshold float64) *SimpleAnomalyDetector {
	if len(values) == 0 {
		return &SimpleAnomalyDetector{threshold: threshold}
	}

	sorted := make([]float64, len(values))
	copy(sorted, values)
	sort.Float64s(sorted)

	// Calculate median
	n := len(sorted)
	var median float64
	if n%2 == 0 {
		median = (sorted[n/2-1] + sorted[n/2]) / 2
	} else {
		median = sorted[n/2]
	}

	// Calculate MAD
	deviations := make([]float64, n)
	for i, v := range values {
		deviations[i] = math.Abs(v - median)
	}
	sort.Float64s(deviations)
	var mad float64
	if n%2 == 0 {
		mad = (deviations[n/2-1] + deviations[n/2]) / 2
	} else {
		mad = deviations[n/2]
	}

	// Calculate mean and stddev
	mean := CalculateMean(values)
	stddev := CalculateStdDev(values, mean)

	return &SimpleAnomalyDetector{
		median:    median,
		mad:       mad,
		mean:      mean,
		stddev:    stddev,
		threshold: threshold,
	}
}

// DetectSimple uses multiple methods to detect anomalies
func (d *SimpleAnomalyDetector) DetectSimple(value float64) (isAnomaly bool, score float64, methods []string) {
	if d.stddev == 0 && d.mad == 0 {
		return false, 0, nil
	}

	var scores []float64

	// Z-score method
	if d.stddev > 0 {
		zscore := math.Abs((value - d.mean) / d.stddev)
		scores = append(scores, zscore)
		if zscore >= d.threshold {
			methods = append(methods, "zscore")
		}
	}

	// MAD method
	if d.mad > 0 {
		madScore := math.Abs(0.6745 * (value - d.median) / d.mad)
		scores = append(scores, madScore)
		if madScore >= d.threshold {
			methods = append(methods, "mad")
		}
	} else if d.median > 0 && math.Abs(value-d.median) > 0.01*d.median {
		// If MAD is 0 but value differs significantly
		scores = append(scores, 999)
		methods = append(methods, "mad")
	}

	// Calculate combined score (max of individual scores)
	maxScore := 0.0
	for _, s := range scores {
		if s > maxScore {
			maxScore = s
		}
	}

	return len(methods) > 0, maxScore, methods
}
