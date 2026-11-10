# Attention Is All You Need

The dominant sequence transduction models are based on complex recurrent or convolutional neural networks. The Transformer allows modeling dependencies without regard to their distance in the input or output sequences.

## Abstract

We propose a new simple network architecture, the Transformer, based solely on attention mechanisms, dispensing with recurrence and convolutions entirely. Experiments on two machine translation tasks show these models to be superior in quality while being more parallelizable and requiring significantly less time to train.

## Introduction

Recurrent neural networks, long short-term memory and gated recurrent neural networks in particular, have been firmly established as state of the art approaches in sequence modeling and transduction problems such as language modeling and machine translation.