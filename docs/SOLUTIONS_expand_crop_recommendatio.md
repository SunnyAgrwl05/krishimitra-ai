from sklearn.ensemble import RandomForestClassifier
import numpy as np
# Example usage:
X = np.array([[1, 2], [3, 4], [5, 6]])
y = np.array([0, 1, 0])

model = RandomForestClassifier()
model.fit(X, y)