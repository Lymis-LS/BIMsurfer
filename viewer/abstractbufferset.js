import FatLineRenderer from './fatlinerenderer.js'

export default class AbstractBufferSet {
    
    constructor() {
        this.geometryIdToIndex = new Map();
    };

    joinConsecutiveRanges(ranges) {
        while (true) {
			var removed = false;
			for (let i = 0; i < ranges.length - 1; ++i) {
				let a = ranges[i];
				let b = ranges[i+1];
				if (a[1] == b[0]) {
					ranges.splice(i, 2, [a[0], b[1]]);
					removed = true;
				}
			}
			if (!removed) {
				break;
			}
		}
    }

    complementRanges(ranges) {
        // @todo: horribly inefficient, do not try this at home.
        var complement =  [[0, this.nrIndices]];
        ranges.forEach((range)=>{
            let [a, b] = range;
            const break_out_foreach = {};
            try {
                complement.forEach((originalRange, i)=>{
                    let [o, p] = originalRange;
                    if (a >= o && a <= p) {
                        if (o == a) {
                            complement[i][0] = b;
                        } else {
                            complement.splice(i, 1, [o, a], [b, p]);
                        }							
                        throw break_out_foreach;
                    }
                });
            } catch (e) {
                if (e !== break_out_foreach) {
                    throw e;
                }
            }
        });

        return complement;
    }

    createLineRenderer(gl, a, b) {
        const lineRenderer = new FatLineRenderer(gl, {
            quantize: this.positionBuffer.js_type !== Float32Array.name
        });

        const positions = new window[this.positionBuffer.js_type](this.nrPositions);
        const indices = new window[this.indexBuffer.js_type](b-a);
        
        // @todo: get only part of positions [min(indices), max(indices)]
        var restoreArrayBinding = gl.getParameter(gl.ARRAY_BUFFER_BINDING);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
        gl.getBufferSubData(gl.ARRAY_BUFFER, 0, positions);
        
        var restoreElementBinding = gl.getParameter(gl.ELEMENT_ARRAY_BUFFER_BINDING);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
        gl.getBufferSubData(gl.ELEMENT_ARRAY_BUFFER, a * 4, indices, 0, indices.length);
        
        const s = new Set();
        
        for (let i = 0; i < indices.length; i += 3) {
            let abc = indices.subarray(i, i + 3);

            for (let j = 0; j < 3; ++j) {
                let ab = [abc[j], abc[(j+1)%3]];
                ab.sort();
                let abs = ab.join(":");

                if (s.has(abs)) {
                    s.delete(abs);
                } else {
                    s.add(abs);
                }
            }
        }
        
        for (let e of s) {
            let [a,b] = e.split(":");
            let A = positions.subarray(a * 3).subarray(0,3);
            let B = positions.subarray(b * 3).subarray(0,3);
            lineRenderer.pushVertices(A, B);
        }			

        lineRenderer.finalize();            

        gl.bindBuffer(gl.ARRAY_BUFFER, restoreArrayBinding);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, restoreElementBinding);

        return lineRenderer;
    }

    computeVisibleInstances(ids_with_or_without, gl) {
        var ids = Object.values(ids_with_or_without)[0];
        var exclude = "without" in ids_with_or_without;
        
        // Wow set equality is really broken. This is going to hurt performance.
		var ids_str = Array.from(ids || []);
		ids_str.sort();
		ids_str = Object.keys(ids_with_or_without)[0] + ':' +  ids_str.join(',');

        {
            var cache_lookup;
            if ((cache_lookup = this.visibleRanges.get(ids_str))) {
                return cache_lookup;
            }
        }

        let ranges = [];
        this.objects.forEach((ob, i) => {
            if (!ids || ids.has(ob.id) != exclude) {
                ranges.push([i, i+1]);
            }
        });

        this.joinConsecutiveRanges(ranges);

        this.visibleRanges.set(ids_str, ranges);

        if (!exclude && ranges.length && this.lineIndexBuffers.size === 0) {
            let lineRenderer = this.createLineRenderer(gl, 0, this.indexBuffer.N);
            this.objects.forEach((ob) => {
                this.lineIndexBuffers.set(ob.id, lineRenderer);
            });
        }

        return ranges;
    }
    
    computeVisibleRanges(ids_with_or_without, gl) {
		var ids = Object.values(ids_with_or_without)[0];
		var exclude = "without" in ids_with_or_without;

		// Wow set equality is really broken. This is going to hurt performance.
		var ids_str = Array.from(ids || []);
		ids_str.sort();
		ids_str = Object.keys(ids_with_or_without)[0] + ':' +  ids_str.join(',');

        {
            var cache_lookup;
            if ((cache_lookup = this.visibleRanges.get(ids_str))) {
                return cache_lookup;
            }
        }

        if (ids === null || ids.size === 0) {
            return [[0, this.nrIndices]];
        }

        // generator function that yields ranges in this buffer for the selected ids
        function* _(geometryIdToIndex) {
            var oids;
            for (var i of ids) {
                if ((oids = geometryIdToIndex.get(i))) {
                    for (var j = 0; j < oids.length; ++j) {
                        yield [i, [oids[j].start, oids[j].start + oids[j].length]];
                    }
                }
            }
        };

		const id_ranges = Array.from(_(this.geometryIdToIndex)).sort();
		const ranges = id_ranges.map((arr) => {return arr[1];});

		this.joinConsecutiveRanges(ranges);

		if (exclude) {
            let complement = this.complementRanges(ranges);
			// store in cache
			this.visibleRanges.set(ids_str, complement);
			return complement;
		}		

        // store in cache
        this.visibleRanges.set(ids_str, ranges);

        // Create fat line renderings for these elements. This should (a) 
        // not in the draw loop (b) maybe in something like a web worker
        id_ranges.forEach((range, i) => {
            let [id, [a, b]] = range;
            if (this.lineIndexBuffers.has(id)) {
                return;
            }
			let lineRenderer = this.createLineRenderer(gl, a, b);
            this.lineIndexBuffers.set(id, lineRenderer);
        });
       
        return ranges;
	}
	
	reset() {
		this.positionsIndex = 0;
		this.normalsIndex = 0;
		this.pickColorsIndex = 0;
		this.indicesIndex = 0;
		this.nrIndices = 0;
		this.bytes = 0;
		this.visibleRanges = new Map();
		this.geometryIdToIndex = new Map();
		this.lineIndexBuffers = new Map();
	}

	copy(gl, objectId) {
		let idx = this.geometryIdToIndex.get(objectId)[0];
		let [offset, length] = [idx.start, idx.length];

		const indices = new Uint32Array(length);

		var restoreElementBinding = gl.getParameter(gl.ELEMENT_ARRAY_BUFFER_BINDING);
		gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
		gl.getBufferSubData(gl.ELEMENT_ARRAY_BUFFER, offset * 4, indices, 0, indices.length);
		gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, restoreElementBinding);

		let [minIndex, maxIndex] = [Math.min.apply(null, indices), Math.max.apply(null, indices)];
		let numVertices = maxIndex - minIndex + 1;

		let returnDictionary = {};
		let toCopy = ["positionBuffer", "normalBuffer", "colorBuffer", "pickColorBuffer"];
		
		toCopy.forEach((name) => {
			let buffer = this[name];
			let bytes_per_elem = window[buffer.js_type].BYTES_PER_ELEMENT;
			let gpu_data = new window[buffer.js_type](numVertices * buffer.components);

			var restoreArrayBinding = gl.getParameter(gl.ARRAY_BUFFER_BINDING);
			gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
			gl.getBufferSubData(gl.ARRAY_BUFFER, minIndex * bytes_per_elem * buffer.components, gpu_data, 0, gpu_data.length);
			gl.bindBuffer(gl.ARRAY_BUFFER, restoreArrayBinding);

			let shortName = name.replace("Buffer", "") + "s";
			returnDictionary[shortName] = gpu_data;
			returnDictionary["nr" + shortName.substr(0,1).toUpperCase() + shortName.substr(1)] = gpu_data.length;
		});

		for (let i = 0; i < indices.length; ++i) {
			indices[i] -= minIndex;
		}

		returnDictionary["indices"] = indices;
		returnDictionary["nrIndices"] = indices.length;

		return returnDictionary;
	}

	setColor(gl, objectId, clr) {
		if (clr.length == 4 && this.hasTransparency != (clr[3] < 1.)) {
			return false;
		}

		var oldColors, newColors, clrArray;

		if (clr.length == 4) {
			let factor = this.colorBuffer.js_type == Uint8Array.name ? 255. : 1.;
			clrArray = new window[this.colorBuffer.js_type](4);
			for (let i = 0; i < 4; ++i) {
				clrArray[i] = clr[i] * factor;
			}
		} else {
			newColors = clr;
		}

		this.geometryIdToIndex.get(objectId).forEach((idx) => {
			let [offet, length] = [idx.color, idx.colorLength];
			let bytes_per_elem = window[this.colorBuffer.js_type].BYTES_PER_ELEMENT;
			
			// Assumes there is just one index pair, this is for now always the case.
			oldColors = new window[this.colorBuffer.js_type](length);

			if (clr.length == 4) {
				newColors = new window[this.colorBuffer.js_type](length);
				for (let i = 0; i < length; i += 4) {
					newColors.set(clrArray, i);
				}
			}

			var restoreArrayBinding = gl.getParameter(gl.ARRAY_BUFFER_BINDING);
			gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuffer);
			gl.getBufferSubData(gl.ARRAY_BUFFER, offet * bytes_per_elem, oldColors, 0, length);
			gl.bufferSubData(gl.ARRAY_BUFFER, offet * bytes_per_elem, newColors, 0, length);
			gl.bindBuffer(gl.ARRAY_BUFFER, restoreArrayBinding);
		});

		return oldColors;
	}
}